import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Environment } from '../game/Environment.jsx'
import { CARS } from '../game/constants.js'
import { keys } from '../game/input.js'
import { drive, getBestScore, updateBestScore } from './hudState.js'
import { Retro } from './Retro.jsx'
import { ps1CarModel } from './ps1.js'
import { carHue, PAINTS } from './paint.js'
import { session, bumpDistance } from './session.js'
import { musicState, updateAudio } from './audio.js'
import { net, sendState } from './net.js'
import { settings } from './settings.js'
import { Ghosts } from './Ghosts.jsx'
import { Traffic, trafficBoxes } from './Traffic.jsx'

/**
 * Endless sunset cruise — a kinematic arcade drive (no physics). The car sits at
 * z = 0 and only slides left/right; the road markings and roadside palms scroll
 * toward the camera and recycle, so you're forever heading into the sun that
 * sits far down +z. Steer-only: A/D or ← →.
 */
const CAR = CARS.bmw
const ROAD_W = 16            // asphalt width (m) — narrower road
const MAX_X = ROAD_W / 2 - 1.4
const BACK = -60             // recycle window (behind camera)
const FWD = 900              // recycle window (ahead)
const TOP_SPEED = 80         // top speed (m/s ≈ 288 km/h, like a real M3)
const WHEELBASE = 2.7        // m — turning radius R = wheelbase / tan(steer)
const MAX_STEER = 0.36       // rad at a standstill; shrinks quickly with speed
const STEER_IN = 2.2         // the wheel cranks to lock slowly, like a real column
const STEER_OUT = 1.8        // …and eases back to centre
const HEADING_CAP = 0.42     // rad — hard ceiling on nose angle (keeps low-speed agility)
const LAT_MAX = 9            // m/s — max sideways slide; the master "steering feel" knob.
                             // The heading cap is derived from this so a lane change crosses
                             // the road at the same pace at 40 or 80 m/s. ~7 relaxed, ~12 loose.
const HEADING_MASS = 5.5     // chassis inertia — heavier at speed means slower response
const ALIGN_GRIP = 1.8       // hands off: the tyres realign the nose with the road
// ── Drift feel: a visual tail-out slip angle that wakes up at speed ──────────
const DRIFT_SPEED = 30       // m/s (~108 km/h) — drift only wakes up above this
const DRIFT_MAX = 0.45       // rad — deepest tail-out slip angle (~26°)
const DRIFT_IN = 3.2         // how fast the slide builds when you commit to a turn
const DRIFT_OUT = 2.0        // …and how lazily it lets go (holds the slide a beat)
const DRIFT_SCRUB = 9        // m/s² of speed bled off while sliding hard
const ENGINE_POWER = 22       // m/s² at launch, falling off toward top speed
const BRAKE_POWER = 32       // m/s² strong braking
const COAST_DRAG = 2.8       // m/s² engine braking, plus a little aero drag
const DASH_PITCH = 11          // spacing of centre-line dashes (denser reads more continuous)
const PALM_PITCH = 32          // spacing of roadside palm groups
const PLAYER_HALF_W = 1.0    // player car collision half-extents (m)
const PLAYER_HALF_L = 2.2
const HIT_COOLDOWN = 0.8     // s — stops one overlap re-triggering every frame
const SMASH_BOOST = 28       // unused; kept for compatibility

/**
 * Camera presets, cycled with V (San-Andreas style, hard cuts). The car faces
 * +z, so `back` < 0 sits behind it and `back` > 0 sits on the bonnet.
 *  follow   how tightly the camera tracks the car's lateral drift
 *  lookXMul how much the aim point leans with the car
 */
const CAMS = [
    { name: 'CHASE',  lag: 0.6, follow: 3,  height: 2.8,  back: -7.2, lookXMul: 0.4, lookY: 1.35, lookZ: 32, fov: 64 },
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
    const dashGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.7, 4.5); g.rotateX(-Math.PI / 2); return g }, [])
    // transparent:true only to push the dashes into the post-reflection draw pass
    // so the sun-glitter layer can't wash them out (they stay crisp on the road).
    const dashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4faf0', transparent: true }), [])
    const skidGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.3, 2.6); g.rotateX(-Math.PI / 2); return g }, [])
    const skidMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0b0b12', transparent: true, opacity: 0.8 }), [])

    // ── Sun reflection: a "glitter path" of the sun on the asphalt. It's a column
    // centred under the sun that pinches toward the horizon (converging on the sun)
    // and widens toward the car, broken into shimmering glints by scrolling value
    // noise so it reads as light dancing on the road rather than a painted wash.
    const reflectMat = useMemo(() => new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#ff8a3c') }, uTime: { value: 0 } },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
            varying vec2 vUv; uniform vec3 uColor; uniform float uTime;
            float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float vnoise(vec2 p){
                vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                float a = hash(i), b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }
            void main() {
                float y = vUv.y;                                   // 0 near car → 1 at the horizon
                // Column pinched toward the sun, wide near the car.
                float halfW = mix(0.55, 0.06, smoothstep(0.0, 1.0, y));
                float cx = abs(vUv.x - 0.5) / max(halfW, 0.001);
                float column = smoothstep(1.0, 0.0, cx);
                // Bright at the sun's base, easing out toward the car; the very top
                // fades so it never smears a hard edge into the horizon line.
                float bright = smoothstep(0.02, 0.4, y) * (1.0 - smoothstep(0.9, 1.0, y));
                // Glints: chunky value noise (survives the pixelation), finer toward
                // the sun, scrolling toward the car so the road appears to rush beneath.
                vec2 np = vec2(vUv.x * 8.0, y * (10.0 + y * 16.0) - uTime * 2.4);
                float g = vnoise(np) * (0.65 + 0.55 * vnoise(np * 2.1 + 11.0));
                float glint = smoothstep(0.30, 0.60, g);
                // Warmer/whiter near the sun, deeper orange lower down.
                vec3 col = mix(uColor, vec3(1.0, 0.88, 0.66), smoothstep(0.45, 1.0, y));
                float a = column * bright * (0.30 + 1.35 * glint);
                gl_FragColor = vec4(col, a * 0.62);
            }
        `,
    }), [])
    const dashN = Math.ceil((FWD - BACK) / DASH_PITCH)
    const dashZ = useMemo(() => Array.from({ length: dashN }, (_, i) => BACK + i * DASH_PITCH), [dashN])
    const skidMarks = useRef(Array.from({ length: 88 }, () => ({ active: false, x: 0, z: -2, rot: 0, life: 0, wheelPos: 0 })))

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
    const state = useRef({ carX: 0, carZ: 0, heading: 0, targetHeading: 0, steerAngle: 0, drift: 0, speed: 0, spin: 0, camX: 0, cam: 0, prevV: false, paint: 0, prevC: false, netT: 0, shake: 0, hitCooldown: [], crashes: 0, nearMisses: 0, nearMissTracked: {}, nearMissBoostTime: 0 })

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05)
        const s = state.current
        reflectMat.uniforms.uTime.value += dt

        const braking = session.started && (keys.KeyS || keys.ArrowDown)
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
            // Lay rubber under heavy braking OR while the tail is hung out in a drift.
            const drifting = Math.abs(s.drift) > 0.18
            if ((braking && s.speed > 20) || drifting) {
                // Create marks from 4 wheels: front-left, front-right, rear-left, rear-right
                const wheelOffset = 0.9  // half-width of car (where wheels are)
                const frontZ = -2.8      // front wheel offset
                const rearZ = -4.2       // rear wheel offset
                for (let wheelSide of [-1, 1]) {
                    for (let wheelZ of [frontZ, rearZ]) {
                        const slot = skidMarks.current.find((mark) => !mark.active) || skidMarks.current[0]
                        slot.active = true
                        slot.life = 1
                        slot.x = s.carX + wheelSide * wheelOffset
                        slot.z = wheelZ
                        slot.rot = 0
                        slot.wheelPos = wheelSide  // track left/right
                    }
                }
            }

            for (let i = 0; i < skidMarks.current.length; i++) {
                const mark = skidMarks.current[i]
                if (!mark.active) {
                    dummy.position.set(0, 0.03, -100)
                    dummy.rotation.set(0, 0, 0)
                    dummy.scale.setScalar(0.1)  // invisible when inactive
                    dummy.updateMatrix()
                    skidRef.current.setMatrixAt(i, dummy.matrix)
                    continue
                }
                dummy.position.set(mark.x, 0.02, mark.z)
                dummy.rotation.set(0, mark.rot, 0)
                dummy.scale.setScalar(1.0)  // constant width for wheel marks
                dummy.updateMatrix()
                skidRef.current.setMatrixAt(i, dummy.matrix)
            }
            skidRef.current.instanceMatrix.needsUpdate = true
            
            // Update material color opacity per instance
            if (skidRef.current.material) {
                const colors = []
                for (const mark of skidMarks.current) {
                    const alpha = mark.active ? mark.life * 0.8 : 0
                    colors.push(alpha)
                }
                skidRef.current.material.opacity = 0.8
            }
        }

        // Pedals, not autopilot: W/↑ is the throttle, S/↓ the brake, and with
        // no input the car coasts down on engine braking + drag. Boost (Shift)
        // raises the top speed while the tank lasts. The drive still quickens
        // as the song builds, and the finale stretch pins the throttle.
        const prog = session.started ? musicState.progress : 0
        const throttling = session.started && (keys.KeyW || keys.ArrowUp)
        // Brake wins over throttle: hold both and you slow down, like a real pedal box.
        if (braking) {
            s.speed = Math.max(0, s.speed - BRAKE_POWER * dt)
        } else if (throttling) {
            // Engine power fades as you approach top speed — a real power curve.
            s.speed = Math.min(TOP_SPEED, s.speed + ENGINE_POWER * Math.max(0.12, 1 - s.speed / TOP_SPEED) * dt)
        } else {
            s.speed = Math.max(0, s.speed - (COAST_DRAG + s.speed * 0.012) * dt)
        }

        // ── Kinematic bicycle: the front wheels hold a steering angle, which
        // sets a turning radius, which rotates the heading; the car then moves
        // where the nose points. Left (A/←) steers toward +x (screen-left).
        const steerInput = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0)
        // Less lock at speed (stability) — the front wheels can't crank as far the
        // faster you go, like a real speed-sensitive steering rack.
        const steerLock = MAX_STEER / (1 + s.speed / 12)
        const steerTarget = steerInput * steerLock
        s.steerAngle = THREE.MathUtils.damp(s.steerAngle, steerTarget, steerInput ? STEER_IN : STEER_OUT, dt)

        // Yaw rate from the bicycle geometry — no speed, no turn. The chassis
        // carries inertia: the nose follows the wheels' command with weight,
        // so the car leans into a turn instead of snapping like a bicycle.
        const yawRate = (s.speed / WHEELBASE) * Math.tan(s.steerAngle)
        // Cap the *lateral velocity* (speed·sin heading), not the nose angle, so a
        // lane change slides across the road at the same pace at any speed — that's
        // the quantity the eye reads as "steering speed". The sensitivity slider
        // (0.3–2.0×) scales this budget; below ~latMax/sin(HEADING_CAP) the fixed
        // angle cap wins, keeping the car nimble at low speed.
        const latMax = LAT_MAX * settings.steeringSensitivity
        const capDyn = Math.min(HEADING_CAP, Math.asin(Math.min(0.99, latMax / Math.max(s.speed, 1))))
        s.targetHeading = THREE.MathUtils.clamp(s.targetHeading + yawRate * dt, -capDyn, capDyn)
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
        // ── Drift: at speed, hard cornering slips the tail out. Kinematic, so this
        // is a visual slip angle (rad) layered on the travel heading — the nose
        // points further into the corner than the car is actually going. It ramps
        // in above DRIFT_SPEED, deepens with steering, holds a beat when you ease
        // off, and bleeds a little speed like real tyres scrubbing.
        const driftReady = THREE.MathUtils.clamp((s.speed - DRIFT_SPEED) / 18, 0, 1)
        const driftTarget = steerInput * driftReady * DRIFT_MAX
        s.drift = THREE.MathUtils.damp(s.drift, driftTarget, steerInput ? DRIFT_IN : DRIFT_OUT, dt)
        if (Math.abs(s.drift) > 0.12) s.speed = Math.max(0, s.speed - Math.abs(s.drift) * DRIFT_SCRUB * dt)

        // Traffic: detect collisions (crashes) and near misses
        if (session.started) {
           for (let i = 0; i < trafficBoxes.length; i++) {
               if ((s.hitCooldown[i] || 0) > 0) { s.hitCooldown[i] -= dt; continue }
               const box = trafficBoxes[i]
               if (box.smash) continue
               const dx = s.carX - box.x
               const dz = s.carZ - box.z
               const collisionDist = PLAYER_HALF_W + box.halfWidth
               const collisionDz = PLAYER_HALF_L + box.halfLen
               const nearMissDist = collisionDist * 1.5
               const nearMissDz = collisionDz * 1.5
                 
               // Detect crash (collision)
               if (Math.abs(dx) < collisionDist && Math.abs(dz) < collisionDz) {
                   s.hitCooldown[i] = HIT_COOLDOWN
                   s.crashes++
                   delete s.nearMissTracked[i]  // clear near miss tracking for this box
                   if (box.big) {
                       // Crash into truck: car stalls and resets to center with 0 speed
                       s.speed = 0
                       s.carX = 0  // reset to center of road
                       s.targetHeading = 0
                       s.heading = 0
                       s.steerAngle = 0
                       s.shake = 2  // strong impact shake
                   } else {
                       box.smash = true
                       s.speed *= 0.9
                       s.shake = 0.55
                   }
               } 
               // Detect near miss (close but no collision)
               else if (!s.nearMissTracked[i] && Math.abs(dx) < nearMissDist && Math.abs(dz) < nearMissDz) {
                   s.nearMisses++
                   s.nearMissTracked[i] = true
                   // Grant 10 km/h speed boost for 5 seconds
                   s.speed += 10 / 3.6  // convert km/h to m/s
                   s.nearMissBoostTime = 5.0  // 5 second boost duration
               }
           }
        }
        
        // Update near miss boost timer
        if (s.nearMissBoostTime > 0) {
           s.nearMissBoostTime -= dt
        }
        // Camera Z height: stay at cruise position
        const cruiseZ = 0.15
        s.carZ = THREE.MathUtils.damp(s.carZ, cruiseZ, 7.5, dt)

        // Car transform: the nose follows the heading (plus drift tail-out),
        // the body rolls against the lateral g of the turn.
        const lateralG = yawRate * s.speed
        if (carRef.current) {
            carRef.current.position.set(s.carX, 0, s.carZ)
            // Body roll: lean with the cornering g, and lean harder into a drift so
            // the chassis visibly rolls onto its outside wheels while the tail is out.
            const lean = THREE.MathUtils.clamp(lateralG * 0.005, -0.12, 0.12) + s.drift * 0.22
            carRef.current.rotation.z = THREE.MathUtils.damp(carRef.current.rotation.z, lean, 8, dt)
            carRef.current.rotation.y = s.heading + s.drift
            carRef.current.rotation.x = THREE.MathUtils.damp(carRef.current.rotation.x, 0, 6, dt)
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

        // Fixed chase cam: only tracks the car's lateral drift, no song-driven motion.
        const C = CAMS[0]
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
        updateAudio(Math.min(1, s.speed / TOP_SPEED))

        // Broadcast our state ~15 Hz and read the rival gap.
        s.netT += dt
        if (s.netT > 0.066) {
            s.netT = 0
            sendState({ name: net.name, dist: session.distance, x: s.carX, hue: carHue.value, kmh: drive.kmh })
        }
        let gap = null
        for (const id in net.players) { if (id !== net.id) { gap = Math.round(net.players[id].dist - session.distance); break } }

        drive.kmh = Math.round(fwdSpeed * 3.6)
        drive.cam = C.name
        drive.paint = PAINTS[s.paint].name
        drive.crashes = s.crashes
        drive.nearMisses = s.nearMisses
        drive.distance = Math.round(session.distance / 1000 * 10) / 10  // km
        drive.time = Math.round(musicState.time)  // seconds
        drive.nearMissBoostActive = s.nearMissBoostTime
         
        // Calculate score (distance - crashes penalty)
        const score = drive.distance - s.crashes * 0.5
        updateBestScore(score)
        drive.bestScore = getBestScore()

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
            {/* Sun reflection shimmer, mirrored down the centre of the road (drawn
                before the dashes so it can't wash the centre line) */}
            <mesh material={reflectMat} renderOrder={-1} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 430]}>
                <planeGeometry args={[7, 820]} />
            </mesh>
            {[-1, 1].map((sgn) => (
                <mesh key={sgn} rotation={[-Math.PI / 2, 0, 0]} position={[sgn * (ROAD_W / 2 - 0.5), 0.01, 700]}>
                    <planeGeometry args={[0.3, 1800]} />
                    <meshBasicMaterial color="#ffb35e" />
                </mesh>
            ))}
            <instancedMesh ref={dashRef} args={[dashGeo, dashMat, dashN]} renderOrder={2} frustumCulled={false} />
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
