import * as THREE from 'three'

/**
 * Procedural track geometry from a closed centerline.
 *
 * Because we author the ribbon ourselves, road-vs-wall is known by construction
 * — no slope/material heuristics. We return separate road and wall geometries so
 * the caller can give each its own collider friction (grip vs slide), plus a
 * spawn seated on the line facing along it.
 */
function makeGeo(verts, idx) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
}

export function buildTrack({ points, roadWidth = 18, wallHeight = 4, wallBase = -1.5, samples = 600 }) {
    const curve = new THREE.CatmullRomCurve3(
        points.map((p) => new THREE.Vector3(p[0], 0, p[1])), true, 'catmullrom', 0.5,
    )
    const N = samples
    const half = roadWidth / 2

    // Sample the loop: centre, road-plane tangent, and left/right edges.
    const C = [], T = [], L = [], R = []
    for (let i = 0; i < N; i++) {
        const t = i / N
        const c = curve.getPointAt(t)
        const tan = curve.getTangentAt(t); tan.y = 0; tan.normalize()
        const n = new THREE.Vector3(tan.z, 0, -tan.x) // right-hand perpendicular in XZ
        C.push(c); T.push(tan)
        L.push(c.clone().addScaledVector(n, half))
        R.push(c.clone().addScaledVector(n, -half))
    }

    // ── Road ribbon (flat at y = 0) ──────────────────────────────────────────
    const rv = [], ri = []
    for (let i = 0; i < N; i++) rv.push(L[i].x, 0, L[i].z, R[i].x, 0, R[i].z)
    for (let i = 0; i < N; i++) {
        const a = i * 2, b = ((i + 1) % N) * 2
        ri.push(a, a + 1, b + 1, a, b + 1, b)
    }
    const roadGeo = makeGeo(rv, ri)
    // UVs: u across the road, v repeating down its length (for lane texture later)
    const ruv = []
    for (let i = 0; i < N; i++) { const v = i / N * (N / 12); ruv.push(0, v, 1, v) }
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2))

    // ── Barrier walls at both edges (vertical strips, double-sided material) ──
    const wv = [], wi = []
    const pushWall = (edge) => {
        const base = wv.length / 3
        // Wall runs from below the road (no coplanar seam to launch off) to full height.
        for (let i = 0; i < N; i++) wv.push(edge[i].x, wallBase, edge[i].z, edge[i].x, wallHeight, edge[i].z)
        for (let i = 0; i < N; i++) {
            const a = base + i * 2, b = base + ((i + 1) % N) * 2
            wi.push(a, a + 1, b + 1, a, b + 1, b)
        }
    }
    pushWall(L); pushWall(R)
    const wallGeo = makeGeo(wv, wi)

    // ── Centre dashes (dash 2 samples on / 3 off, lifted to avoid z-fight) ────
    const dv = [], di = []
    const lh = 0.28
    for (let i = 0; i < N; i++) {
        if (i % 5 >= 2) continue
        const n = new THREE.Vector3(T[i].z, 0, -T[i].x)
        const c0 = C[i], c1 = C[(i + 1) % N]
        const base = dv.length / 3
        dv.push(
            c0.x + n.x * lh, 0.02, c0.z + n.z * lh,
            c0.x - n.x * lh, 0.02, c0.z - n.z * lh,
            c1.x - n.x * lh, 0.02, c1.z - n.z * lh,
            c1.x + n.x * lh, 0.02, c1.z + n.z * lh,
        )
        di.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const lineGeo = makeGeo(dv, di)

    const spawn = {
        x: C[0].x, y: 0, z: C[0].z,
        heading: Math.atan2(T[0].x, T[0].z),
    }

    return { curve, roadGeo, wallGeo, lineGeo, spawn }
}
