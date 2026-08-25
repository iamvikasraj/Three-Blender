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
import { ps1CarModel } from './ps1.js'
import { carHue, PAINTS } from './paint.js'
import { session, bumpDistance } from './session.js'
import { musicState, updateAudio } from './audio.js'
import { net, sendState } from './net.js'
import { Ghosts } from './Ghosts.jsx'
import { Traffic, trafficBoxes } from './Traffic.jsx'

/**
 * Endless sunset cruise — a kinematic arcade drive (no physics). The car sits at
 * z = 0 and only slides left/right; the road markings and roadside palms scroll
 * toward the camera and recycle, so you're forever heading into the sun that
 * sits far down +z. Steer-only: A/D or ← →.
 */
const CAR = CARS.bmw
const ROAD_W = 22            // asphalt width (m)
const MAX_X = ROAD_W / 2 - 1.4
const BACK = -60             // recycle window (behind camera)
const FWD = 900              // recycle window (ahead)
const CRUISE = 32            // top cruise speed (m/s ≈ 115 km/h)
const BOOST_SPEED = 45       // ~162 km/h while boosting
const WHEELBASE = 2.7        // m — turning radius R = wheelbase / tan(steer)
const MAX_STEER = 0.36       // rad at a standstill; shrinks quickly with speed
const STEER_IN = 2.2         // the wheel cranks to lock slowly, like a real column
const STEER_OUT = 1.8        // …and eases back to centre
const HEADING_CAP = 0.42     // rad — gentle lane changes, never sideways
const HEADING_MASS = 3.6     // chassis inertia — the body follows the wheels with weight
const ALIGN_GRIP = 1.8       // hands off: the tyres realign the nose with the road
const ENGINE_POWER = 8       // m/s² at launch, falling off toward top speed
const BRAKE_POWER = 18       // m/s²
const COAST_DRAG = 1.6       // m/s² engine braking, plus a little aero drag
const DASH_PITCH = 16
const PALM_PITCH = 32          // spacing of roadside palm groups
const PLAYER_HALF_W = 1.0    // player car collision half-extents (m)
const PLAYER_HALF_L = 2.2
const HIT_COOLDOWN = 0.8     // s — stops one overlap re-triggering every frame
const SMASH_BOOST = 28       // boost meter % banked per car you ram/wreck

/**
 * Camera presets, cycled with V (San-Andreas style, hard cuts). The car faces
 * +z, so `back` < 0 sits behind it and `back` > 0 sits on the bonnet.
 *  follow   how tightly the camera tracks the car's lateral drift
 *  lookXMul how much the aim point leans with the car
 */
const CAMS = [
    { name: 'CHASE',  lag: 0.6, follow: 3,  height: 2.8,  back: -7.2, lookXMul: 0.4, lookY: 1.35, lookZ: 32, fov: 64 },
    { name: 'NEAR',   lag: 0.7, follow: 4,  height: 1.9,  back: -4.2, lookXMul: 0.5, lookY: 1.1,  lookZ: 30, fov: 70 },
    { name: 'BONNET', lag: 1.0, follow: 12, height: 1.05, back: 2.2,  lookXMul: 1.0, lookY: 1.15, lookZ: 60, fov: 82 },
]

export function SunsetScene() {
    const { camera } = useThree()
    const carRef = useRef(null)
    const brakeLightRef = useRef(null)
    const dashRef = useRef(null)
    const skidRef = useRef(null)
    const { scene } = useGLTF(CAR.path)
    const { scene: palmScene } = useGLTF('/models/tropical_palm_tree.glb')

    // ── Car: load, align nose to +z, seat on the road, index wheels ──────────
    const { carRoot, wheels, frontWheels } = useMemo(() => {
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
        // Front wheels (nose is +z) get the steering angle on top of the roll.
        const byZ = wheels.slice().sort((a, b) => a.getWorldPosition(new THREE.Vector3()).z - b.getWorldPosition(new THREE.Vector3()).z)
        return { carRoot, wheels, frontWheels: byZ.slice(-2) }
    }, [scene])

    // ── Scrolling props: centre dashes ───────────────────────────────────────
    const dashGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.5, 4); g.rotateX(-Math.PI / 2); return g }, [])
    const dashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#eef6ea' }), [])
    const skidGeo = useMemo(() => { const g = new THREE.PlaneGeometry(1, 2.6); g.rotateX(-Math.PI / 2); return g }, [])
    const skidMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0b0b12', transparent: true, opacity: 0.8 }), [])
    const dashN = Math.ceil((FWD - BACK) / DASH_PITCH)
    const dashZ = useMemo(() => Array.from({ length: dashN }, (_, i) => BACK + i * DASH_PITCH), [dashN])
    const skidMarks = useRef(Array.from({ length: 44 }, () => ({ active: false, x: 0, z: -2, rot: 0, life: 0 })))

    // ── Roadside palms: authored GLB models spread across the wide apron ─────
    const palmGroupRef = useRef(null)
    const palmN = Math.ceil((FWD - BACK) / PALM_PITCH) * 4
    const palms = useMemo(() => Array.from({ length: palmN }, (_, i) => {
        const side = i % 2 ? 1 : -1
        const row = Math.floor(i / 2)
        const noise = (seed) => (Math.sin(i * seed) + 1) / 2
        return {
            x: side * (ROAD_W / 2 + 3 + noise(1.71) * 8),
            z: BACK + row * PALM_PITCH + noise(2.37) * 18 - 9,
            rot: noise(3.19) * Math.PI * 2,
            s: 0.72 + noise(4.11) * 0.52,
            lean: (noise(5.43) - 0.5) * 0.18,
            crownScale: 0.78 + noise(6.79) * 0.38,
        }
    }), [palmN])
    const palmTrees = useMemo(() => palms.map((_, i) => {
        const tree = cloneSkeleton(palmScene)
        const bounds = new THREE.Box3().setFromObject(tree)
        const height = Math.max(0.001, bounds.max.y - bounds.min.y)
        tree.userData.modelScale = 6 / height
        tree.scale.setScalar(tree.userData.modelScale)
        const normalizedBounds = new THREE.Box3().setFromObject(tree)
        tree.userData.baseY = -normalizedBounds.min.y
        tree.position.y = tree.userData.baseY
        tree.traverse((child) => {
            if (!child.isMesh) return
            child.castShadow = true
            // Silhouette the palms against the sunset: near-black, unlit, but keep
            // the leaf-cutout alpha from the source texture so the fronds read.
            const src = Array.isArray(child.material) ? child.material[0] : child.material
            const dark = new THREE.MeshBasicMaterial({ color: '#0a0812', fog: true })
            // Keep the source map (color→black, but its alpha channel still cuts the
            // fronds), alpha-tested so the leaf shapes stay crisp silhouettes.
            if (src?.map) { dark.map = src.map; dark.alphaTest = 0.5; dark.side = THREE.DoubleSide }
            child.material = dark
        })
        return tree
    }), [palmScene, palms])

    const dummy = useMemo(() => new THREE.Object3D(), [])
    const state = useRef({ carX: 0, carZ: 0, heading: 0, targetHeading: 0, steerAngle: 0, drift: 0, speed: 0, spin: 0, camX: 0, cam: 0, prevV: false, paint: 0, prevC: false, boost: 100, netT: 0, shake: 0, hitCooldown: [] })

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05)
        const s = state.current

        const braking = session.started && (keys.KeyS || keys.ArrowDown) && s.speed > 8
        if (brakeLightRef.current) {
            brakeLightRef.current.intensity = braking ? 16 : 1.2
            brakeLightRef.current.color.set(braking ? '#ff3b3b' : '#ffb173')
        }

        if (skidRef.current) {
            for (const mark of skidMarks.current) {
                if (!mark.active) continue
                mark.life -= dt * 0.7
                if (mark.life <= 0) {
                    mark.active = false
                    continue
                }
                mark.z -= s.speed * dt * 0.8
                mark.x = s.carX + Math.sin(mark.life * 18) * 0.18
            }

            const activeMarks = skidMarks.current.filter((mark) => mark.active)
            if (braking && s.speed > 20) {
                const slot = skidMarks.current.find((mark) => !mark.active) || skidMarks.current[0]
                slot.active = true
                slot.life = 1
                slot.x = s.carX
                slot.z = -3.5
                slot.rot = 0
            }

            for (let i = 0; i < skidMarks.current.length; i++) {
                const mark = skidMarks.current[i]
                if (!mark.active) {
                    dummy.position.set(0, 0.03, -100)
                    dummy.rotation.set(0, 0, 0)
                    dummy.updateMatrix()
                    skidRef.current.setMatrixAt(i, dummy.matrix)
                    continue
                }
                dummy.position.set(mark.x, 0.02, mark.z)
                dummy.rotation.set(0, mark.rot, 0)
                dummy.scale.setScalar(0.9 + mark.life * 0.8)
                dummy.updateMatrix()
                skidRef.current.setMatrixAt(i, dummy.matrix)
            }
            skidRef.current.instanceMatrix.needsUpdate = true
        }

        // Pedals, not autopilot: W/↑ is the throttle, S/↓ the brake, and with
        // no input the car coasts down on engine braking + drag. Boost (Shift)
        // raises the top speed while the tank lasts. The drive still quickens
        // as the song builds, and the finale stretch pins the throttle.
        const prog = session.started ? musicState.progress : 0
        const finale = prog > 0.965
        const boosting = session.started && (keys.ShiftLeft || keys.ShiftRight) && s.boost > 0
        const throttling = session.started && (keys.KeyW || keys.ArrowUp)
        const vTop = finale ? BOOST_SPEED * 2 : boosting ? BOOST_SPEED * (1 + prog * 0.5) : CRUISE * (1 + prog * 0.7)
        if (throttling || boosting || finale) {
            // Engine power fades as you approach top speed — a real power curve.
            s.speed = Math.min(vTop, s.speed + ENGINE_POWER * Math.max(0.12, 1 - s.speed / vTop) * dt)
        } else if (braking) {
            s.speed = Math.max(0, s.speed - BRAKE_POWER * dt)
        } else {
            s.speed = Math.max(0, s.speed - (COAST_DRAG + s.speed * 0.012) * dt)
        }
        if (boosting) s.boost = Math.max(0, s.boost - 18 * dt)   // limited tank — refills only via takedowns

        // ── Kinematic bicycle: the front wheels hold a steering angle, which
        // sets a turning radius, which rotates the heading; the car then moves
        // where the nose points. Left (A/←) steers toward +x (screen-left).
        const steerInput = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0)
        // Less lock at speed (stability), a touch more while boosting (drift out)
        const steerLock = MAX_STEER / (1 + s.speed / 18) * (boosting ? 1.25 : 1)
        const steerTarget = steerInput * steerLock
        s.steerAngle = THREE.MathUtils.damp(s.steerAngle, steerTarget, steerInput ? STEER_IN : STEER_OUT, dt)

        // Yaw rate from the bicycle geometry — no speed, no turn. The chassis
        // carries inertia: the nose follows the wheels' command with weight,
        // so the car leans into a turn instead of snapping like a bicycle.
        const yawRate = (s.speed / WHEELBASE) * Math.tan(s.steerAngle)
        s.targetHeading = THREE.MathUtils.clamp(s.targetHeading + yawRate * dt, -HEADING_CAP, HEADING_CAP)
        // Hands off: grip walks the nose back parallel to the road.
        if (steerInput === 0) s.targetHeading = THREE.MathUtils.damp(s.targetHeading, 0, ALIGN_GRIP, dt)
        s.heading = THREE.MathUtils.damp(s.heading, s.targetHeading, HEADING_MASS, dt)

        // The car travels along its heading; forward progress is the z-part.
        const fwdSpeed = s.speed * Math.cos(s.heading)
        s.carX += Math.sin(s.heading) * s.speed * dt
        if (Math.abs(s.carX) > MAX_X) {
            // Road edge: scrape along the shoulder, nose forced parallel.
            s.carX = THREE.MathUtils.clamp(s.carX, -MAX_X, MAX_X)
            s.targetHeading = THREE.MathUtils.damp(s.targetHeading, 0, 8, dt)
            s.heading = THREE.MathUtils.damp(s.heading, 0, 8, dt)
        }
        // Boost drift: rear steps out visually (kept for the arcade feel).
        s.drift = THREE.MathUtils.damp(s.drift, boosting && steerInput !== 0 ? steerInput * (0.42 + s.speed / BOOST_SPEED * 0.4) : 0, boosting ? 4.5 : 7.2, dt)

        // Traffic: ram a sedan to WRECK it and bank boost (a takedown); trucks
        // & buses are heavy obstacles that scrape your speed off, so dodge them.
        // Boost is a limited tank — refilled ONLY by takedowns.
        if (session.started) {
            for (let i = 0; i < trafficBoxes.length; i++) {
                if ((s.hitCooldown[i] || 0) > 0) { s.hitCooldown[i] -= dt; continue }
                const box = trafficBoxes[i]
                if (box.smash) continue
                const dx = s.carX - box.x
                const dz = s.carZ - box.z
                if (Math.abs(dx) < PLAYER_HALF_W + box.halfWidth && Math.abs(dz) < PLAYER_HALF_L + box.halfLen) {
                    s.hitCooldown[i] = HIT_COOLDOWN
                    if (box.big) {
                        s.speed *= 0.5
                        const kickDir = dx !== 0 ? Math.sign(dx) : (i % 2 ? 1 : -1)
                        s.carX = THREE.MathUtils.clamp(s.carX + kickDir * 3.2, -MAX_X, MAX_X)
                        s.targetHeading = kickDir * 0.28   // knocked sideways, nose kicked out
                        s.shake = 1
                    } else {
                        box.smash = true
                        s.boost = Math.min(100, s.boost + SMASH_BOOST)
                        s.speed *= 0.9
                        s.shake = 0.55
                    }
                }
            }
        }
        // Boost adds a forward Z drift in the car's facing direction; once the
        // booster is released it settles back to the normal cruise position.
        const cruiseZ = 0.15
        const boostZTarget = boosting ? 2.2 + Math.min(4.5, s.speed * 0.04) : cruiseZ
        s.carZ = THREE.MathUtils.damp(s.carZ, boostZTarget, boosting ? 5.5 : 7.5, dt)

        // Car transform: the nose follows the heading (plus drift tail-out),
        // the body rolls against the lateral g of the turn.
        const lateralG = yawRate * s.speed
        if (carRef.current) {
            carRef.current.position.set(s.carX, 0, s.carZ)
            carRef.current.rotation.z = THREE.MathUtils.damp(carRef.current.rotation.z, THREE.MathUtils.clamp(lateralG * 0.004, -0.12, 0.12) - s.drift * 0.05, 9, dt)
            carRef.current.rotation.y = s.heading + s.drift * 0.12
            carRef.current.rotation.x = THREE.MathUtils.damp(carRef.current.rotation.x, boosting ? -0.03 : 0, 6, dt)
        }
        // Wheels: all roll; the front pair also shows the steering angle.
        s.spin += (s.speed / 0.34) * dt
        const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.spin)
        const qSteer = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.steerAngle)
        for (const w of wheels) {
            w.quaternion.copy(w.userData.base)
            if (frontWheels.includes(w)) w.quaternion.multiply(qSteer)
            w.quaternion.multiply(qSpin)
        }

        // Scroll dashes toward -z, recycle to the front.
        if (dashRef.current) {
            for (let i = 0; i < dashN; i++) {
                let z = dashZ[i] - fwdSpeed * dt; if (z < BACK) z += (FWD - BACK)
                dashZ[i] = z
                dummy.position.set(0, 0.02, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix()
                dashRef.current.setMatrixAt(i, dummy.matrix)
            }
            dashRef.current.instanceMatrix.needsUpdate = true
        }
        // Scroll authored palms and recycle them into the wide roadside apron.
        if (palmGroupRef.current) {
            for (let i = 0; i < palmN; i++) {
                const p = palms[i]
                p.z -= fwdSpeed * dt; if (p.z < BACK) p.z += (FWD - BACK)
                const tree = palmGroupRef.current.children[i]
                const treeScale = p.s * p.crownScale
                tree.position.set(p.x, tree.userData.baseY * treeScale, p.z)
                tree.rotation.set(0, p.rot, p.lean)
                tree.scale.setScalar(tree.userData.modelScale * treeScale)
            }
        }

        // Camera: cycle presets on V (edge-detected), then place it. Hard cuts.
        if (keys.KeyV && !s.prevV) s.cam = (s.cam + 1) % CAMS.length
        s.prevV = !!keys.KeyV
        const C = CAMS[s.cam]
        // Fixed chase cam: only tracks the car's lateral drift, no song-driven motion.
        s.camX += (s.carX * C.lag - s.camX) * Math.min(1, dt * C.follow)
        // Hit shake: brief scattered jitter when you scrape traffic.
        s.shake = THREE.MathUtils.damp(s.shake, 0, 6, dt)
        const shakeAmp = s.shake * 0.26
        const jx = (Math.random() - 0.5) * shakeAmp
        const jy = (Math.random() - 0.5) * shakeAmp * 0.7
        camera.position.set(s.camX + jx, C.height + jy, C.back)
        camera.lookAt(s.carX * C.lookXMul + jx * 1.5, C.lookY + jy * 1.5, C.lookZ)
        camera.rotation.z += (Math.random() - 0.5) * shakeAmp * 0.05
        if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix() }

        // Paint toggle on C (edge-detected): re-hue the whole car.
        if (keys.KeyC && !s.prevC) { s.paint = (s.paint + 1) % PAINTS.length; carHue.value = PAINTS[s.paint].hue }
        s.prevC = !!keys.KeyC

        if (session.started) bumpDistance(Math.abs(s.speed) * dt)
        updateAudio(Math.min(1, s.speed / CRUISE), boosting)

        // Broadcast our state ~15 Hz and read the rival gap.
        s.netT += dt
        if (s.netT > 0.066) {
            s.netT = 0
            sendState({ name: net.name, dist: session.distance, x: s.carX, hue: carHue.value, kmh: drive.kmh, boosting })
        }
        let gap = null
        for (const id in net.players) { if (id !== net.id) { gap = Math.round(net.players[id].dist - session.distance); break } }

        drive.kmh = Math.round(fwdSpeed * 3.6)
        drive.cam = C.name
        drive.paint = PAINTS[s.paint].name
        drive.boost = s.boost / 100
        drive.gap = gap
    })

    return (
        <>
            <Environment preset="synthwave" />

            {/* Ground apron + asphalt + solid edge lines (static; motion comes from the props) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 700]} receiveShadow>
                <planeGeometry args={[800, 1800]} />
                <meshStandardMaterial color="#3a2340" roughness={1} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 700]} receiveShadow>
                <planeGeometry args={[ROAD_W, 1800]} />
                <meshStandardMaterial color="#34364d" roughness={0.92} />
            </mesh>
            {[-1, 1].map((sgn) => (
                <mesh key={sgn} rotation={[-Math.PI / 2, 0, 0]} position={[sgn * (ROAD_W / 2 - 0.5), 0.01, 700]}>
                    <planeGeometry args={[0.3, 1800]} />
                    <meshBasicMaterial color="#ffb35e" />
                </mesh>
            ))}
            <instancedMesh ref={dashRef} args={[dashGeo, dashMat, dashN]} frustumCulled={false} />
            <group ref={palmGroupRef}>
                {palmTrees.map((tree, i) => <primitive key={i} object={tree} />)}
            </group>

            <group ref={carRef}>
                <pointLight position={[-2.8, 2.8, -4]} color="#ffd0a0" intensity={8} distance={18} decay={2} />
                <pointLight position={[2.5, 2, 2.5]} color="#8edbff" intensity={5} distance={15} decay={2} />
                <pointLight ref={brakeLightRef} position={[0, 0.9, -2.45]} color="#ffb173" intensity={1.2} distance={18} decay={2} />
                <primitive object={carRoot} />
            </group>

            <instancedMesh ref={skidRef} args={[skidGeo, skidMat, skidMarks.current.length]} frustumCulled={false} />

            <Ghosts />
            <Traffic />

            <Retro />
        </>
    )
}

useGLTF.preload(CAR.path)
useGLTF.preload('/models/tropical_palm_tree.glb')
