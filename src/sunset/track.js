import * as THREE from 'three'

/**
 * Procedural closed-loop circuit for the sunset drive.
 *
 * The track is a deformed circle (control points at even angles with random
 * radii) smoothed by a closed centripetal Catmull-Rom spline — that guarantees
 * a simple, non-self-intersecting loop with flowing corners. A fixed seed
 * keeps the circuit identical for every player (netcode ghosts share it).
 *
 * Everything on the track is parametrised by ARC LENGTH `s` (metres along the
 * loop) plus a lateral offset `x` (metres left of the centre line). Sample
 * tables are precomputed so per-frame lookups are two lerps, no allocations.
 */

const SEED = 20260825        // fixed — every client builds the same circuit
const CONTROL_POINTS = 12
const BASE_RADIUS = 240      // m — loop ends up ~1.5 km
const SAMPLES = 2048         // arc-length lookup resolution (~0.75 m per step)

// Deterministic PRNG (mulberry32)
function rng(seed) {
    let a = seed >>> 0
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function buildTrack() {
    const rand = rng(SEED)
    const points = []
    for (let i = 0; i < CONTROL_POINTS; i++) {
        const a = (i / CONTROL_POINTS) * Math.PI * 2
        const r = BASE_RADIUS * (0.72 + rand() * 0.55)
        points.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))
    }
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal')
    const length = curve.getLength()

    // Arc-length sample tables
    const positions = curve.getSpacedPoints(SAMPLES) // SAMPLES+1 entries, last ≈ first
    const tangents = []
    const lefts = []
    for (let i = 0; i <= SAMPLES; i++) {
        const t = curve.getTangentAt((i % SAMPLES) / SAMPLES)
        t.y = 0
        t.normalize()
        tangents.push(t)
        lefts.push(new THREE.Vector3(t.z, 0, -t.x)) // up × tangent: facing +z → left is +x
    }

    // Rotate the tables so s = 0 starts the car facing the sun (+z).
    let startIdx = 0
    let best = -Infinity
    for (let i = 0; i < SAMPLES; i++) {
        if (tangents[i].z > best) { best = tangents[i].z; startIdx = i }
    }
    const rot = (arr) => arr.slice(startIdx).concat(arr.slice(1, startIdx + 1))
    const P = rot(positions)
    const T = rot(tangents)
    const L = rot(lefts)

    const wrap = (s) => ((s % length) + length) % length

    // Shortest signed distance a − b along the loop, in [−L/2, L/2)
    const deltaS = (a, b) => {
        let d = wrap(a) - wrap(b)
        if (d > length / 2) d -= length
        if (d < -length / 2) d += length
        return d
    }

    const lerpFrom = (arr, s, out) => {
        const f = (wrap(s) / length) * SAMPLES
        const i = Math.floor(f) % SAMPLES
        const frac = f - Math.floor(f)
        return out.copy(arr[i]).lerp(arr[i + 1], frac)
    }

    return {
        curve,
        length,
        wrap,
        deltaS,
        pointAtS: (s, out) => lerpFrom(P, s, out),
        tangentAtS: (s, out) => lerpFrom(T, s, out).normalize(),
        leftAtS: (s, out) => lerpFrom(L, s, out).normalize(),
        /** World yaw (radians) facing along the track at s. */
        yawAtS(s) {
            const t = this.tangentAtS(s, _tmp)
            return Math.atan2(t.x, t.z)
        },
    }
}

const _tmp = new THREE.Vector3()

/** Shared singleton — SunsetScene, Traffic and Ghosts all drive the same loop. */
export const track = buildTrack()

/**
 * Road ribbon: a triangle strip following the loop, `width` metres wide.
 * Returns a ready BufferGeometry (flat, y = 0).
 */
export function buildRoadGeometry(width, segments = 1024) {
    const half = width / 2
    const pos = new Float32Array((segments + 1) * 2 * 3)
    const p = new THREE.Vector3()
    const l = new THREE.Vector3()
    for (let i = 0; i <= segments; i++) {
        const s = (i / segments) * track.length
        track.pointAtS(s, p)
        track.leftAtS(s, l)
        const o = i * 6
        pos[o] = p.x + l.x * half; pos[o + 1] = 0; pos[o + 2] = p.z + l.z * half
        pos[o + 3] = p.x - l.x * half; pos[o + 4] = 0; pos[o + 5] = p.z - l.z * half
    }
    const idx = []
    for (let i = 0; i < segments; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3
        idx.push(a, b, c, b, d, c)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
}
