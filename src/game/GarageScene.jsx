import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, PerspectiveCamera } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CARS } from './constants.js'

const SPIN = 0.35     // turntable speed (rad/s)
const CAR_SIZE = 4.4  // longest dimension every car is normalised to (m)

/**
 * Car-select showroom — a Burnout-style garage. The selected car sits on a slow
 * turntable under a warm key light with a reflective floor. Ported from
 * garage.js; the HTML stat block / picker lives in GarageOverlay (React DOM).
 */
export function GarageScene({ carKey }) {
    const car = CARS[carKey]
    const table = useRef(null)
    const { gl, scene } = useThree()

    // Showroom environment map (RoomEnvironment via PMREM), applied while the
    // garage is mounted and cleared on the way out.
    useEffect(() => {
        const pmrem = new THREE.PMREMGenerator(gl)
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        const prev = scene.environment
        const prevInt = scene.environmentIntensity
        scene.environment = envTex
        scene.environmentIntensity = 0.5
        return () => {
            scene.environment = prev
            scene.environmentIntensity = prevInt ?? 1
            envTex.dispose()
            pmrem.dispose()
        }
    }, [gl, scene])

    useFrame((_, dt) => { if (table.current) table.current.rotation.y += SPIN * dt })

    return (
        <>
            <color attach="background" args={['#16130f']} />
            <fog attach="fog" args={['#16130f', 14, 46]} />
            <PerspectiveCamera makeDefault fov={38} near={0.1} far={200}
                position={[4.6, 2.0, 6.4]} onUpdate={(c) => c.lookAt(0, 0.7, 0)} />

            {/* Glossy floor + turntable disc */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <circleGeometry args={[26, 64]} />
                <meshStandardMaterial color="#2a2216" metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.04, 0]} receiveShadow>
                <cylinderGeometry args={[3.4, 3.4, 0.08, 64]} />
                <meshStandardMaterial color="#3d3320" metalness={0.6} roughness={0.4} />
            </mesh>

            {/* Warm ambience + hero key light + cool rim */}
            <hemisphereLight args={['#ffd9a0', '#100c08', 0.5]} />
            <ambientLight args={['#ffe6c0', 0.35]} />
            <spotLight color="#fff1d0" intensity={90} distance={30} angle={Math.PI * 0.3}
                penumbra={0.45} decay={1.4} position={[4, 9, 5]} castShadow
                shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
            <spotLight color="#7fb4ff" intensity={45} distance={26} angle={Math.PI * 0.34}
                penumbra={0.5} decay={1.3} position={[-6, 5, -5]} />
            <directionalLight color="#ffab5c" intensity={0.5} position={[-3, 2, 6]} />

            <group ref={table}>
                <GarageCar key={carKey} car={car} />
            </group>
        </>
    )
}

function GarageCar({ car }) {
    const { scene } = useGLTF(car.path)
    const model = useMemo(() => {
        const m = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
        m.scale.setScalar(CAR_SIZE / Math.max(size.x, size.y, size.z))
        m.rotation.y = car.modelYaw
        const box = new THREE.Box3().setFromObject(m)
        m.position.y = -box.min.y + 0.08 // sit on the disc
        m.traverse((c) => { if (c.isMesh) c.castShadow = true })
        return m
    }, [scene, car])

    return <primitive object={model} />
}
