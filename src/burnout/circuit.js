import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { world, RAPIER } from './physics.js'

/**
 * Real circuit — Burnout Revenge "Eternal City" long circuit.
 *
 * The map's geometry is baked in world space, so it loads at identity and the
 * whole thing becomes ONE static trimesh collider: roads, kerbs, walls and
 * buildings all collide for free, with no need to identify the road by name
 * (the node names here are generic `unit_*`, unlike Rockport's `TRN_*Road*`).
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  SCALE        world scale (1 unit ≈ 1 m in this export, so 1)
 *  SPAWN        where the car starts; probeGround() snaps it onto the surface
 */
export const CIRCUIT = {
    path: '/models/maps/opt/burnout_eternal_city.glb',
    // The Sketchfab FBX→glTF conversion bakes a ~0.01 root scale (cm→m), which
    // leaves the city only ~33 units wide. Rescale so the circuit spans real
    // metres and the 4.4 m car is correctly proportioned to it.
    TARGET_SPAN: 3100,
}

export async function loadCircuit(scene, loadingManager) {
    const loader = new GLTFLoader(loadingManager)
    loader.setMeshoptDecoder(MeshoptDecoder)

    const gltf = await new Promise((res, rej) => loader.load(CIRCUIT.path, res, undefined, rej))
    const root = gltf.scene

    // Auto-scale to real-world size from the model's own bounds
    root.scale.setScalar(1)
    root.updateMatrixWorld(true)
    const raw = new THREE.Box3().setFromObject(root)
    const rawSize = raw.getSize(new THREE.Vector3())
    const scale = CIRCUIT.TARGET_SPAN / Math.max(rawSize.x, rawSize.z)
    root.scale.setScalar(scale)
    root.updateMatrixWorld(true)

    // Collect world-space vertices/indices for one big static trimesh
    const verts = []
    const indices = []
    let base = 0
    const v = new THREE.Vector3()

    root.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return
        mesh.castShadow = false
        mesh.receiveShadow = true

        const geo = mesh.geometry
        const pos = geo.attributes.position
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
            verts.push(v.x, v.y, v.z)
        }
        if (geo.index) {
            const idx = geo.index.array
            for (let i = 0; i < idx.length; i++) indices.push(base + idx[i])
        } else {
            for (let i = 0; i < pos.count; i++) indices.push(base + i)
        }
        base += pos.count
    })

    scene.add(root)

    const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(indices))
            .setFriction(1.0)
            .setRestitution(0.05),
    )

    // Rapier only populates the query pipeline (used by castRay) when the world
    // steps, so run one step before anything probes the ground.
    world.step()

    // The map never moves — freeze its matrices so Three.js stops recomputing them
    root.matrixWorldAutoUpdate = false

    return {
        root,
        collider,
        scale,
        triangles: indices.length / 3,
        bounds: raw.clone().expandByScalar(0).applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale)),
    }
}

/**
 * Drop a ray straight down and return the surface height at (x, z), or null.
 * Used to seat the car on the track and to hunt for a valid spawn.
 */
export function probeGround(x, z, fromY = 400) {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 })
    const hit = world.castRay(ray, 1200, true)
    return hit ? fromY - hit.timeOfImpact : null
}

/**
 * Identify the road surface geometrically.
 *
 * Flatness alone is a bad road test — plazas and pavements are flat too, and
 * spawning there faces the car into hedges. But the optimizer joined the map by
 * material (one mesh per material), and in a racing map the single largest
 * horizontal surface IS the tarmac. So we score every mesh by its upward-facing
 * area and take the winner, collecting its triangle centroids as spawn sites.
 *
 * @returns {{mesh: THREE.Mesh, points: THREE.Vector3[], area: number}|null}
 */
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
            if (nrm.y / mag < 0.85) continue // not facing up → wall, kerb, roof edge
            const triArea = mag * 0.5
            if (triArea < 4) continue        // ignore slivers
            area += triArea
            points.push(new THREE.Vector3(
                (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3,
            ))
        }
        if (points.length > 40) candidates.push({ mesh, points, area })
    })

    // Asphalt is dark; big pale surfaces are plazas, medians and untextured
    // ground. Score by area but penalise light materials so tarmac wins.
    const lum = (m) => {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        const c = mat?.color
        return c ? 0.299 * c.r + 0.587 * c.g + 0.114 * c.b : 1
    }
    const hasTex = (m) => {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        return !!mat?.map
    }
    candidates.forEach((c) => {
        c.lum = lum(c.mesh)
        c.textured = hasTex(c.mesh)
        // dark + textured + large = road
        c.score = c.area * (c.textured ? 1 : 0.25) * (1.15 - Math.min(c.lum, 1))
    })
    candidates.sort((a, b) => b.score - a.score)
    candidates.slice(0, 5).forEach((c, i) => console.log(
        `[ROAD ${i}] ${c.mesh.name || '(unnamed)'} area=${Math.round(c.area)}m²`,
        `lum=${c.lum.toFixed(2)} tex=${c.textured} score=${Math.round(c.score)}`))

    return candidates[0] ?? null
}

/**
 * Pick a spawn on the road, facing along it.
 * Heading comes from the principal direction of nearby road points (the 2×2
 * covariance eigenvector), which is the road's local axis.
 */
export function findSpawnOnRoad(road) {
    if (!road?.points?.length) return null
    const pts = road.points

    // Prefer street level: the lower half of road heights
    const ys = pts.map((p) => p.y).sort((x, y) => x - y)
    const cutoff = ys[Math.floor(ys.length * 0.5)]
    const low = pts.filter((p) => p.y <= cutoff)
    const pool = low.length > 20 ? low : pts

    // The most "connected" point: the one with the most road area around it
    let seed = pool[0], bestN = -1
    const stride = Math.max(1, Math.floor(pool.length / 400)) // sample for speed
    for (let i = 0; i < pool.length; i += stride) {
        const p = pool[i]
        let n = 0
        for (let j = 0; j < pool.length; j += stride) {
            const q = pool[j]
            if (Math.abs(q.y - p.y) < 3 && p.distanceToSquared(q) < 60 * 60) n++
        }
        if (n > bestN) { bestN = n; seed = p }
    }

    // Road direction = principal axis of the neighbourhood
    let sxx = 0, sxz = 0, szz = 0, n = 0
    for (const q of pts) {
        if (Math.abs(q.y - seed.y) > 3) continue
        const dx = q.x - seed.x, dz = q.z - seed.z
        if (dx * dx + dz * dz > 70 * 70) continue
        sxx += dx * dx; sxz += dx * dz; szz += dz * dz; n++
    }
    let heading = 0
    if (n > 3) {
        // Principal direction of [[sxx,sxz],[sxz,szz]]
        const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz)
        // ang is measured from +X; our heading is measured from +Z
        heading = Math.atan2(Math.cos(ang), Math.sin(ang))
    }
    return { x: seed.x, y: seed.y, z: seed.z, heading, neighbours: bestN }
}
