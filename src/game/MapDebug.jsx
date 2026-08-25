import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useLoader } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { CIRCUIT } from './constants.js'
import { findRoadSurface, findSpawnOnRoad } from './circuitAnalysis.js'

/**
 * Free-fly visual check for the ripped/merged circuit — no physics, no car.
 * Loads the same CIRCUIT.path (single file or the array of split parts) through
 * the same merge + auto-scale pipeline Circuit.jsx uses, then highlights
 * whatever circuitAnalysis picked as "the road" so a bad heuristic pick is
 * obvious at a glance instead of discovered later via a car floating in void.
 */
function MapContents() {
    const paths = Array.isArray(CIRCUIT.path) ? CIRCUIT.path : [CIRCUIT.path]
    const gltfs = useLoader(GLTFLoader, paths, (loader) => {
        loader.setMeshoptDecoder(MeshoptDecoder)
    })
    const results = Array.isArray(gltfs) ? gltfs : [gltfs]

    const { scene, spawn, span } = useMemo(() => {
        const root = new THREE.Group()
        for (const g of results) root.add(g.scene)
        root.updateMatrixWorld(true)
        const rawSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
        const scale = CIRCUIT.TARGET_SPAN / Math.max(rawSize.x, rawSize.z)
        root.scale.setScalar(scale)
        root.updateMatrixWorld(true)

        const road = findRoadSurface(root)
        if (road) {
            const highlight = new THREE.MeshBasicMaterial({ color: '#22ff88' })
            road.mesh.material = highlight
        }
        const sp = findSpawnOnRoad(road)

        return { scene: root, spawn: sp, span: CIRCUIT.TARGET_SPAN }
    }, [results])

    return (
        <>
            <primitive object={scene} />
            {spawn && (
                <mesh position={[spawn.x, spawn.y + 3, spawn.z]}>
                    <sphereGeometry args={[3, 16, 16]} />
                    <meshBasicMaterial color="#ff3355" />
                </mesh>
            )}
            <gridHelper args={[span, 20, '#556', '#334']} />
        </>
    )
}

export function MapDebug() {
    return (
        <Canvas
            gl={{ antialias: true }}
            camera={{ position: [0, CIRCUIT.TARGET_SPAN * 0.55, CIRCUIT.TARGET_SPAN * 0.3], fov: 50, near: 1, far: 20000 }}
        >
            <ambientLight intensity={1.4} />
            <directionalLight position={[500, 900, 300]} intensity={1.2} />
            <Suspense fallback={null}>
                <MapContents />
            </Suspense>
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={15000} />
            <Stats />
        </Canvas>
    )
}
