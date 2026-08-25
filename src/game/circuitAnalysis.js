import * as THREE from 'three'

/**
 * Geometric spawn-finding for the circuit — pure three.js, no physics. Ported
 * verbatim from circuit.js: score every mesh by upward-facing, dark, textured
 * area (that's the tarmac), then seat the car on the most connected point of it
 * facing along the road's principal axis.
 */

/** @returns {{mesh: THREE.Mesh, points: THREE.Vector3[], area: number}|null} */
export function findRoadSurface(root) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3()
    const candidates = []

    root.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return
        const geo = mesh.geometry
        const pos = geo.attributes.position
        const idx = geo.index
        const triCount = idx ? idx.count / 3 : pos.count / 3
        let area = 0
        const points = []

        for (let t = 0; t < triCount; t++) {
            const i0 = idx ? idx.getX(t * 3) : t * 3
            const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
            const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
            a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld)
            b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld)
            c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld)
            ab.subVectors(b, a); ac.subVectors(c, a)
            nrm.crossVectors(ab, ac)
            const mag = nrm.length()
            if (mag < 1e-6) continue
            if (nrm.y / mag < 0.85) continue
            const triArea = mag * 0.5
            if (triArea < 4) continue
            area += triArea
            points.push(new THREE.Vector3(
                (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3,
            ))
        }
        // Skip coarse filler geometry — a huge flat "ground"/backdrop quad scores
        // well on raw area alone, but real pavement is tessellated at road-lane
        // scale (a few m² per triangle), not tens of metres per triangle.
        const avgTriArea = points.length ? area / points.length : Infinity
        if (points.length > 40 && avgTriArea < 60) candidates.push({ mesh, points, area, avgTriArea })
    })

    const lum = (m) => {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        const col = mat?.color
        return col ? 0.299 * col.r + 0.587 * col.g + 0.114 * col.b : 1
    }
    const hasTex = (m) => {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        return !!mat?.map
    }
    candidates.forEach((cd) => {
        cd.lum = lum(cd.mesh)
        cd.textured = hasTex(cd.mesh)
        cd.score = cd.area * (cd.textured ? 1 : 0.25) * (1.15 - Math.min(cd.lum, 1))
    })
    candidates.sort((x, y) => y.score - x.score)
    candidates.slice(0, 5).forEach((cd, i) => console.log(
        `[ROAD ${i}] ${cd.mesh.name || '(unnamed)'} area=${Math.round(cd.area)}m²`,
        `lum=${cd.lum.toFixed(2)} tex=${cd.textured} score=${Math.round(cd.score)}`))

    return candidates[0] ?? null
}

export function findSpawnOnRoad(road) {
    if (!road?.points?.length) return null
    const pts = road.points

    const ys = pts.map((p) => p.y).sort((x, y) => x - y)
    const cutoff = ys[Math.floor(ys.length * 0.5)]
    const low = pts.filter((p) => p.y <= cutoff)
    const pool = low.length > 20 ? low : pts

    let seed = pool[0], bestN = -1
    const stride = Math.max(1, Math.floor(pool.length / 400))
    for (let i = 0; i < pool.length; i += stride) {
        const p = pool[i]
        let n = 0
        for (let j = 0; j < pool.length; j += stride) {
            const q = pool[j]
            if (Math.abs(q.y - p.y) < 3 && p.distanceToSquared(q) < 60 * 60) n++
        }
        if (n > bestN) { bestN = n; seed = p }
    }

    let sxx = 0, sxz = 0, szz = 0, n = 0
    for (const q of pts) {
        if (Math.abs(q.y - seed.y) > 3) continue
        const dx = q.x - seed.x, dz = q.z - seed.z
        if (dx * dx + dz * dz > 70 * 70) continue
        sxx += dx * dx; sxz += dx * dz; szz += dz * dz; n++
    }
    let heading = 0
    if (n > 3) {
        const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz)
        heading = Math.atan2(Math.cos(ang), Math.sin(ang))
    }
    const width = measureRoadWidth(road.mesh, seed, heading)
    console.log(`[ROAD] this road is ${width.toFixed(1)} m wide`,
        `(→ ${(width / 3.5).toFixed(1)} lanes at the current scale)`)

    return { x: seed.x, y: seed.y, z: seed.z, heading, neighbours: bestN, roadWidth: width }
}

export function measureRoadWidth(roadMesh, at, heading, limit = 400) {
    const rc = new THREE.Raycaster()
    rc.far = 1e4
    const down = new THREE.Vector3(0, -1, 0)
    const px = -Math.cos(heading), pz = Math.sin(heading)
    const step = Math.max(0.25, limit / 400)

    const edge = (sign) => {
        let d = 0
        for (; d < limit; d += step) {
            const o = new THREE.Vector3(at.x + px * d * sign, at.y + 40, at.z + pz * d * sign)
            rc.set(o, down)
            if (rc.intersectObject(roadMesh, false).length === 0) break
        }
        return d
    }
    return edge(1) + edge(-1)
}
