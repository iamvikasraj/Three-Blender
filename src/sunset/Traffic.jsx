import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ps1Model } from './ps1.js'
import { drive } from './hudState.js'
import { session } from './session.js'

/**
 * Ambient traffic: slow vehicles scattered across every lane that the player
 * cruises past. Positioned with the same scroll-and-recycle trick as the road
 * props in SunsetScene, but scrolled by the RELATIVE speed (player − traffic)
 * so faster traffic falls further behind while slower traffic gets overtaken.
 * Reads the player's speed off the `drive` HUD bridge so this stays decoupled
 * from SunsetScene's frame loop.
 *
 * Dedicated ripped rigs (not the player's own car) — length is the model's
 * longest raw dimension (they're all authored nose/tail along Z), so scaling
 * by `len` keeps a bus reading as bus-sized next to a truck. `halfWidth` feeds
 * SunsetScene's collision check.
 */
// All vehicles are heavy obstacles — clipping one scrapes your speed off,
// so you want to dodge them. They crawl along slow so you blow past them.
const VEHICLES = {
    tractor: { path: '/models/traffic%20cars/tractor_cab_traffic_burnout_3.glb', len: 6.4, halfWidth: 1.3, modelYaw: 0, speed: [10, 14], big: true },
    longnose: { path: '/models/traffic%20cars/longnose_cab_traffic_burnout_3.glb', len: 7.2, halfWidth: 1.35, modelYaw: 0, speed: [10, 14], big: true },
    bus: { path: '/models/traffic%20cars/city_bus_traffic_burnout_3.glb', len: 11, halfWidth: 1.45, modelYaw: 0, speed: [9, 12], big: true },
}
// Trucks and buses only — heavy obstacles to dodge.
const TYPES = [VEHICLES.tractor, VEHICLES.longnose, VEHICLES.tractor, VEHICLES.bus, VEHICLES.longnose, VEHICLES.tractor]

const BACK = -60
const FWD = 900
const SPAN = FWD - BACK
const TRAFFIC_N = 6   // sparse — trucks far apart, ~160 m between vehicles
const LANES = [-8.5, -6, -3.5, 3.5, 6, 8.5]   // both sides of the centre line
const LANE_JITTER = 1

const noise = (i, seed) => (Math.sin(i * seed + seed) + 1) / 2

const DEFS = Array.from({ length: TRAFFIC_N }, (_, i) => {
    const type = TYPES[i % TYPES.length]
    return {
        type,
        z0: BACK + (i / TRAFFIC_N) * SPAN + (noise(i, 1.7) - 0.5) * 40,
        x: LANES[i % LANES.length] + (noise(i, 3.3) - 0.5) * LANE_JITTER,
        speed: type.speed[0] + noise(i, 5.1) * (type.speed[1] - type.speed[0]),
    }
})

// Per-car (x, z, halfLen, halfWidth) snapshot, kept live by each TrafficCar
// below — SunsetScene reads this every frame to check the player against it,
// the same "mutable bridge, no re-render" pattern as `drive`/`session`.
export const trafficBoxes = DEFS.map((d) => ({ x: d.x, z: d.z0, halfLen: d.type.len / 2, halfWidth: d.type.halfWidth, big: !!d.type.big, smash: false }))

export function Traffic() {
    return DEFS.map((def, i) => <TrafficCar key={i} def={def} index={i} />)
}

function TrafficCar({ def, index }) {
    const { scene } = useGLTF(def.type.path)
    const groupRef = useRef(null)
    const z = useRef(def.z0)
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
        // a quick tumble, keep sliding it past the camera, then respawn it fresh
        // far ahead in its lane.
        if (box.smash && !smash.current) {
            smash.current = { t: 0, vy: 8 + Math.random() * 4, spinX: (Math.random() - 0.5) * 16, spinZ: (Math.random() - 0.5) * 12 }
        }
        if (smash.current) {
            const sm = smash.current
            sm.t += dt
            sm.vy -= 26 * dt
            z.current -= (drive.kmh / 3.6) * dt
            g.position.set(def.x, Math.max(-6, g.position.y + sm.vy * dt), z.current)
            g.rotation.x += sm.spinX * dt
            g.rotation.z += sm.spinZ * dt
            box.z = z.current
            if (sm.t > 0.9) {
                z.current = FWD - Math.random() * 120
                g.rotation.set(0, 0, 0)
                g.position.set(def.x, 0, z.current)
                box.z = z.current
                box.smash = false
                smash.current = null
            }
            return
        }

        if (session.started) {
            const closing = drive.kmh / 3.6 - def.speed
            let nz = z.current - closing * dt
            if (nz < BACK) nz += SPAN
            if (nz > FWD) nz -= SPAN
            z.current = nz
        }
        box.z = z.current
        g.position.set(def.x, 0, z.current)
    })

    return <group ref={groupRef}><primitive object={root} /></group>
}

Object.values(VEHICLES).forEach((v) => useGLTF.preload(v.path))
