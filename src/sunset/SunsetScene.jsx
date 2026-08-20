import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Environment } from '../game/Environment.jsx'
import { CARS } from '../game/constants.js'
import { keys } from '../game/input.js'
import { drive } from './hudState.js'
import { Retro } from './Retro.jsx'
import { ps1CarModel, ps1Material } from './ps1.js'
import { carHue, PAINTS } from './paint.js'
import { session, bumpDistance } from './session.js'
import { updateAudio } from './audio.js'

/**
 * Endless sunset cruise — a kinematic arcade drive (no physics). The car sits at
 * z = 0 and only slides left/right; the road markings and roadside pylons scroll
 * toward the camera and recycle, so you're forever heading into the sun that
 * sits far down +z. Steer-only: A/D or ← →.
 */
const CAR = CARS.bmw
const ROAD_W = 22            // asphalt width (m)
const MAX_X = ROAD_W / 2 - 1.4
const BACK = -60             // recycle window (behind camera)
const FWD = 900              // recycle window (ahead)
const CRUISE = 74            // top cruise speed (m/s ≈ 266 km/h)
const LAT_SPEED = 22         // lateral m/s
const DASH_PITCH = 16
const POST_PITCH = 34

/**
 * Camera presets, cycled with V (San-Andreas style, hard cuts). The car faces
 * +z, so `back` < 0 sits behind it and `back` > 0 sits on the bonnet.
 *  follow   how tightly the camera tracks the car's lateral drift
 *  lookXMul how much the aim point leans with the car
 */
const CAMS = [
    { name: 'CHASE',  lag: 0.6, follow: 3,  height: 3.4,  back: -9.5, lookXMul: 0.4, lookY: 1.6,  lookZ: 40, fov: 68 },
    { name: 'NEAR',   lag: 0.7, follow: 4,  height: 2.2,  back: -5.2, lookXMul: 0.5, lookY: 1.2,  lookZ: 40, fov: 74 },
    { name: 'BONNET', lag: 1.0, follow: 12, height: 1.05, back: 2.2,  lookXMul: 1.0, lookY: 1.15, lookZ: 60, fov: 82 },
]

export function SunsetScene() {
    const { camera } = useThree()
    const carRef = useRef(null)
    const dashRef = useRef(null)
    const postRef = useRef(null)
    const { scene } = useGLTF(CAR.path)

    // ── Car: load, align nose to +z, seat on the road, index wheels ──────────
    const { carRoot, wheels } = useMemo(() => {
        const model = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
        model.scale.setScalar(4.4 / Math.max(size.x, size.y, size.z))
        model.rotation.y = CAR.modelYaw
        const box = new THREE.Box3().setFromObject(model)
        model.position.y = -box.min.y
        model.traverse((c) => { if (c.isMesh) c.castShadow = true })
        const carRoot = new THREE.Group(); carRoot.add(model); carRoot.updateWorldMatrix(true, true)
        const wheels = []
        model.traverse((o) => { if (CAR.wheelPattern.test(o.name)) { o.userData.base = o.quaternion.clone(); wheels.push(o) } })
        ps1CarModel(carRoot, 90, carHue) // PS1 wobble + crunchy textures + paintable hue
        return { carRoot, wheels }
    }, [scene])

    // ── Scrolling props: centre dashes + alternating neon pylons ─────────────
    const dashGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.5, 4); g.rotateX(-Math.PI / 2); return g }, [])
    const dashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#eef6ea' }), [])
    const dashN = Math.ceil((FWD - BACK) / DASH_PITCH)
    const dashZ = useMemo(() => Array.from({ length: dashN }, (_, i) => BACK + i * DASH_PITCH), [dashN])

    const postGeo = useMemo(() => new THREE.BoxGeometry(0.4, 5, 0.4), [])
    const postMat = useMemo(() => ps1Material(new THREE.MeshStandardMaterial({
        color: '#06150f', emissive: '#4fd8a0', emissiveIntensity: 2.2, roughness: 0.4,
    }), 90), [])
    const postN = Math.ceil((FWD - BACK) / POST_PITCH) * 2
    const posts = useMemo(() => Array.from({ length: postN }, (_, i) => {
        const side = i % 2 ? 1 : -1
        return { z: BACK + Math.floor(i / 2) * POST_PITCH, x: side * (ROAD_W / 2 + 3) }
    }), [postN])

    const dummy = useMemo(() => new THREE.Object3D(), [])
    const state = useRef({ carX: 0, speed: 0, spin: 0, camX: 0, cam: 0, prevV: false, paint: 0, prevC: false })

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05)
        const s = state.current

        // Ease up to cruise speed once the run has started (0 on the title screen).
        const target = session.started ? CRUISE : 0
        s.speed += (target - s.speed) * Math.min(1, dt * 0.5)

        // Steer-only: A/← left, D/→ right. Camera looks down +z, so screen-left
        // is world +x — steer left (+1) must increase carX.
        const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0)
        s.carX = THREE.MathUtils.clamp(s.carX + steer * LAT_SPEED * dt, -MAX_X, MAX_X)

        // Car transform: slide + a little lean/yaw into the steer.
        if (carRef.current) {
            carRef.current.position.set(s.carX, 0, 0)
            carRef.current.rotation.z = -steer * 0.12
            carRef.current.rotation.y = steer * 0.09
        }
        s.spin += (s.speed / 0.34) * dt
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.spin)
        for (const w of wheels) w.quaternion.copy(w.userData.base).multiply(q)

        // Scroll dashes toward -z, recycle to the front.
        if (dashRef.current) {
            for (let i = 0; i < dashN; i++) {
                let z = dashZ[i] - s.speed * dt; if (z < BACK) z += (FWD - BACK)
                dashZ[i] = z
                dummy.position.set(0, 0.02, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix()
                dashRef.current.setMatrixAt(i, dummy.matrix)
            }
            dashRef.current.instanceMatrix.needsUpdate = true
        }
        // Scroll pylons likewise.
        if (postRef.current) {
            for (let i = 0; i < postN; i++) {
                const p = posts[i]
                p.z -= s.speed * dt; if (p.z < BACK) p.z += (FWD - BACK)
                dummy.position.set(p.x, 2.5, p.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix()
                postRef.current.setMatrixAt(i, dummy.matrix)
            }
            postRef.current.instanceMatrix.needsUpdate = true
        }

        // Camera: cycle presets on V (edge-detected), then place it. Hard cuts.
        if (keys.KeyV && !s.prevV) s.cam = (s.cam + 1) % CAMS.length
        s.prevV = !!keys.KeyV
        const C = CAMS[s.cam]
        s.camX += (s.carX * C.lag - s.camX) * Math.min(1, dt * C.follow)
        camera.position.set(s.camX, C.height, C.back)
        camera.lookAt(s.carX * C.lookXMul, C.lookY, C.lookZ)
        if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix() }

        // Paint toggle on C (edge-detected): re-hue the whole car.
        if (keys.KeyC && !s.prevC) { s.paint = (s.paint + 1) % PAINTS.length; carHue.value = PAINTS[s.paint].hue }
        s.prevC = !!keys.KeyC

        if (session.started) bumpDistance(Math.abs(s.speed) * dt)
        updateAudio(Math.min(1, s.speed / CRUISE))

        drive.kmh = Math.round(s.speed * 3.6)
        drive.cam = C.name
        drive.paint = PAINTS[s.paint].name
    })

    return (
        <>
            <Environment preset="sunset" />

            {/* Ground apron + asphalt + solid edge lines (static; motion comes from the props) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 700]} receiveShadow>
                <planeGeometry args={[800, 1800]} />
                <meshStandardMaterial color="#356b32" roughness={1} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 700]} receiveShadow>
                <planeGeometry args={[ROAD_W, 1800]} />
                <meshStandardMaterial color="#22352b" roughness={0.92} />
            </mesh>
            {[-1, 1].map((sgn) => (
                <mesh key={sgn} rotation={[-Math.PI / 2, 0, 0]} position={[sgn * (ROAD_W / 2 - 0.5), 0.01, 700]}>
                    <planeGeometry args={[0.3, 1800]} />
                    <meshBasicMaterial color="#e6f2d8" />
                </mesh>
            ))}

            <instancedMesh ref={dashRef} args={[dashGeo, dashMat, dashN]} frustumCulled={false} />
            <instancedMesh ref={postRef} args={[postGeo, postMat, postN]} frustumCulled={false} />

            <group ref={carRef}>
                <primitive object={carRoot} />
            </group>

            <Retro />
        </>
    )
}

useGLTF.preload(CAR.path)
