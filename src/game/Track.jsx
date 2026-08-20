import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useRapier } from '@react-three/rapier'
import { TRACK } from './constants.js'
import { buildTrack } from './trackBuilder.js'

/**
 * Procedurally-built race track. The road ribbon and barrier walls are generated
 * from a centerline (trackBuilder), so each gets exactly the collider it should:
 *
 *   • road   → high friction (grip; you can accelerate and corner)
 *   • walls  → low friction  (you SLIDE along them instead of climbing/beaching)
 *   • floor  → a large flat backstop so nothing can ever fall into the void
 *
 * No road-vs-wall guessing — it's known by construction. Drops into RaceScene in
 * place of <Circuit>, reporting the spawn the same way.
 */
export function Track({ onSpawn }) {
    const { world, rapier } = useRapier()
    const t = useMemo(() => buildTrack(TRACK), [])

    const materials = useMemo(() => ({
        road: new THREE.MeshStandardMaterial({ color: '#2b2b31', roughness: 0.96, metalness: 0 }),
        wall: new THREE.MeshStandardMaterial({ color: '#464c57', roughness: 0.8, side: THREE.DoubleSide }),
        line: new THREE.MeshBasicMaterial({ color: '#d8d8e0' }),
        ground: new THREE.MeshStandardMaterial({ color: '#191b21', roughness: 1 }),
    }), [])

    useEffect(() => { onSpawn?.(t.spawn) }, [t, onSpawn])

    // Colliders — one per surface class, each with its own friction.
    useEffect(() => {
        const bodies = []
        const addTrimesh = (geo, friction, restitution) => {
            const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
            const pos = new Float32Array(geo.attributes.position.array)
            const idx = new Uint32Array(geo.index.array)
            world.createCollider(
                rapier.ColliderDesc.trimesh(pos, idx).setFriction(friction).setRestitution(restitution),
                body,
            )
            bodies.push(body)
        }
        addTrimesh(t.roadGeo, 1.0, 0.0)   // grippy road
        addTrimesh(t.wallGeo, 0.08, 0.0)  // slippery walls — slide, don't stick or bounce

        // Safety floor just below the road so a hard landing never falls through.
        const floor = world.createRigidBody(rapier.RigidBodyDesc.fixed())
        world.createCollider(
            rapier.ColliderDesc.cuboid(1600, 0.5, 1600).setTranslation(0, -0.6, 0).setFriction(1),
            floor,
        )
        bodies.push(floor)

        console.log(`[TRACK] built: road + walls + floor colliders, spawn`, t.spawn)
        return () => bodies.forEach((b) => { try { world.removeRigidBody(b) } catch { /* gone */ } })
    }, [t, world, rapier])

    return (
        <group>
            {/* Ground apron under/around the track */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow material={materials.ground}>
                <planeGeometry args={[4000, 4000]} />
            </mesh>
            <mesh geometry={t.roadGeo} material={materials.road} receiveShadow />
            <mesh geometry={t.wallGeo} material={materials.wall} castShadow receiveShadow />
            <mesh geometry={t.lineGeo} material={materials.line} />
        </group>
    )
}
