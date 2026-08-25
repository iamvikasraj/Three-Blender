import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ps1Model } from './ps1.js'
import { drive } from './hudState.js'
import { session } from './session.js'
import { track } from './track.js'

/**
 * Ambient traffic on the loop: slow vehicles holding their lane (a lateral
 * offset from the centre line) while advancing along the track's arc length
 * at their own pace. The player is faster, so you catch and overtake them.
 * Collision data is shared through `trafficBoxes` — SunsetScene reads it
 * every frame, the same "mutable bridge, no re-render" pattern as `drive`.
 *
 * Dedicated ripped rigs (not the player's own car) — length is the model's
 * longest raw dimension (they're all authored nose/tail along Z), so scaling
 * by `len` keeps a bus reading as bus-sized next to a sedan. `halfWidth` feeds
 * SunsetScene's collision check.
 */
// `big` cars (trucks/buses) are heavy obstacles to dodge — clipping one scrapes
// your speed. Small cars (sedans) are takedown targets: ram them to wreck them
// and bank boost. Sedans race along faster so they read as live traffic.
const VEHICLES = {
    sedan: { path: '/models/traffic%20cars/sedan_2_burnout_3.glb', len: 4.6, halfWidth: 0.95, modelYaw: 0, speed: [24, 34], big: false },
    tractor: { path: '/models/traffic%20cars/tractor_cab_traffic_burnout_3.glb', len: 6.4, halfWidth: 1.3, modelYaw: 0, speed: [10, 14], big: true },
    longnose: { path: '/models/traffic%20cars/longnose_cab_traffic_burnout_3.glb', len: 7.2, halfWidth: 1.35, modelYaw: 0, speed: [10, 14], big: true },
    bus: { path: '/models/traffic%20cars/city_bus_traffic_burnout_3.glb', len: 11, halfWidth: 1.45, modelYaw: 0, speed: [9, 12], big: true },
}
// Weighted mix — mostly sedans, the occasional truck or bus.
const TYPES = [VEHICLES.sedan, VEHICLES.sedan, VEHICLES.sedan, VEHICLES.tractor, VEHICLES.sedan, VEHICLES.sedan, VEHICLES.longnose, VEHICLES.sedan, VEHICLES.bus]

const TRAFFIC_N = 16
const LANES = [-8.5, -6, -3.5, 3.5, 6, 8.5]   // both sides of the centre line
const LANE_JITTER = 1
const RESPAWN_AHEAD = 350   // m ahead of the player a wrecked car re-enters

const noise = (i, seed) => (Math.sin(i * seed + seed) + 1) / 2

const DEFS = Array.from({ length: TRAFFIC_N }, (_, i) => {
    const type = TYPES[i % TYPES.length]
    return {
        type,
        s0: (i / TRAFFIC_N) * track.length + (noise(i, 1.7) - 0.5) * 40,
        x: LANES[i % LANES.length] + (noise(i, 3.3) - 0.5) * LANE_JITTER,
        speed: type.speed[0] + noise(i, 5.1) * (type.speed[1] - type.speed[0]),
    }
})

// Per-car (x, s, halfLen, halfWidth) snapshot, kept live by each TrafficCar
// below — SunsetScene reads this every frame to check the player against it.
export const trafficBoxes = DEFS.map((d) => ({ x: d.x, s: d.s0, halfLen: d.type.len / 2, halfWidth: d.type.halfWidth, big: !!d.type.big, smash: false }))

const _p = new THREE.Vector3()
const _l = new THREE.Vector3()

export function Traffic() {
    return DEFS.map((def, i) => <TrafficCar key={i} def={def} index={i} />)
}

function TrafficCar({ def, index }) {
    const { scene } = useGLTF(def.type.path)
    const groupRef = useRef(null)
    const s = useRef(def.s0)
    const smash = useRef(null)   // {t, vy, spinX, spinZ} while a wrecked car is tumbling

    const root = useMemo(() => {
        const model = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
        model.scale.setScalar(def.type.len / Math.max(size.x, size.y, size.z))
        model.rotation.y = def.type.modelYaw
        model.position.y = -new THREE.Box3().setFromObject(model).min.y
        model.traverse((c) => { if (c.isMesh) c.castShadow = true })
        const root = new THREE.Group(); root.add(model)
        ps1Model(root, 90)
        return root
    }, [scene, def.type])

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05)
        const box = trafficBoxes[index]
        const g = groupRef.current
        if (!g) return

        // Rammed by the player (flagged via the shared box): launch this car into
        // a quick tumble where it sits, then respawn it fresh far ahead of the
        // player in its lane.
        if (box.smash && !smash.current) {
            smash.current = { t: 0, vy: 8 + Math.random() * 4, spinX: (Math.random() - 0.5) * 16, spinZ: (Math.random() - 0.5) * 12 }
        }
        if (smash.current) {
            const sm = smash.current
            sm.t += dt
            sm.vy -= 26 * dt
            g.position.y = Math.max(-6, g.position.y + sm.vy * dt)
            g.rotation.x += sm.spinX * dt
            g.rotation.z += sm.spinZ * dt
            if (sm.t > 0.9) {
                s.current = track.wrap(drive.s + RESPAWN_AHEAD + Math.random() * 120)
                g.rotation.set(0, track.yawAtS(s.current), 0)
                track.pointAtS(s.current, _p)
                track.leftAtS(s.current, _l)
                g.position.set(_p.x + _l.x * def.x, 0, _p.z + _l.z * def.x)
                box.s = s.current
                box.smash = false
                smash.current = null
            }
            return
        }

        if (session.started) s.current = track.wrap(s.current + def.speed * dt)
        box.s = s.current
        track.pointAtS(s.current, _p)
        track.leftAtS(s.current, _l)
        g.position.set(_p.x + _l.x * def.x, 0, _p.z + _l.z * def.x)
        g.rotation.set(0, track.yawAtS(s.current), 0)
    })

    return <group ref={groupRef}><primitive object={root} /></group>
}

Object.values(VEHICLES).forEach((v) => useGLTF.preload(v.path))
