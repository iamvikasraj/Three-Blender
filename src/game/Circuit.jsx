import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { useRapier } from '@react-three/rapier'
import { CIRCUIT } from './constants.js'
import { findRoadSurface, findSpawnOnRoad } from './circuitAnalysis.js'

/**
 * The real Burnout Revenge "Eternal City" circuit. The map's geometry is baked
 * in world space, so it becomes ONE static trimesh collider — roads, kerbs,
 * walls and buildings all collide (that's what the wall-scrape mechanic and
 * containment rely on). We auto-scale it to real metres, then hand back a road
 * spawn found geometrically (circuitAnalysis).
 *
 * The optimized export is Meshopt-compressed, so we configure the GLTFLoader
 * with the official MeshoptDecoder explicitly (matching the vanilla build) —
 * more reliable here than the bundled default.
 *
 * PERFORMANCE: we build the collider ourselves as a SINGLE merged trimesh
 * rather than letting react-three-rapier emit one per mesh (this map is 104
 * meshes). One BVH is far cheaper to build at load and to raycast the four
 * wheels against every substep. The distant `backdrop_*` scenery — which the
 * car can never reach — is kept visible but excluded from the collider.
 */
const NON_COLLIDING = /^backdrop/i

export function Circuit({ onSpawn }) {
    const { scene } = useLoader(GLTFLoader, CIRCUIT.path, (loader) => {
        loader.setMeshoptDecoder(MeshoptDecoder)
    })
    const { world, rapier } = useRapier()

    const spawn = useMemo(() => {
        scene.scale.setScalar(1)
        scene.updateMatrixWorld(true)
        const rawSize = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3())
        const scale = CIRCUIT.TARGET_SPAN / Math.max(rawSize.x, rawSize.z)
        scene.scale.setScalar(scale)
        scene.updateMatrixWorld(true)

        scene.traverse((m) => {
            if (m.isMesh) { m.castShadow = false; m.receiveShadow = true }
        })

        const road = findRoadSurface(scene)
        if (road) console.log(`[CIRCUIT] road surface: ${Math.round(road.area)} m², ${road.points.length} tris`)
        const sp = findSpawnOnRoad(road)
        if (sp) console.log('[CIRCUIT] spawn', sp)
        else console.warn('[CIRCUIT] no road spawn found — using default position')
        return sp
    }, [scene])

    useEffect(() => { onSpawn?.(spawn ?? null) }, [spawn, onSpawn])

    // One merged, world-space trimesh collider for the whole drivable city.
    useEffect(() => {
        scene.updateMatrixWorld(true)
        const verts = []
        const indices = []
        let base = 0
        const v = new THREE.Vector3()

        scene.traverse((mesh) => {
            if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return
            if (NON_COLLIDING.test(mesh.name)) return // distant backdrop — visual only
            const pos = mesh.geometry.attributes.position
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
                verts.push(v.x, v.y, v.z)
            }
            const idx = mesh.geometry.index
            if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i))
            else for (let i = 0; i < pos.count; i++) indices.push(base + i)
            base += pos.count
        })

        const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
        world.createCollider(
            rapier.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(indices))
                .setFriction(1)
                .setRestitution(0.05),
            body,
        )
        console.log(`[CIRCUIT] collider: 1 merged trimesh, ${indices.length / 3} tris (backdrop excluded)`)

        return () => { try { world.removeRigidBody(body) } catch { /* already gone */ } }
    }, [scene, world, rapier])

    return <primitive object={scene} />
}
