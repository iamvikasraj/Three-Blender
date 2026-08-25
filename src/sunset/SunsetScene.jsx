import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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
import { carHue } from './paint.js'
import { session, bumpDistance } from './session.js'
import { musicState, updateAudio } from './audio.js'
import { net, sendState } from './net.js'
import { Ghosts } from './Ghosts.jsx'
import { Traffic, trafficBoxes } from './Traffic.jsx'
import { track, buildRoadGeometry } from './track.js'

/**
 * Sunset circuit cruise — a kinematic arcade drive (no physics) around a
 * procedural closed-loop track. The car is parametrised by arc length `s`
 * along the loop plus a lateral offset; the heading comes from the track
 * tangent, so corners carve themselves while steering stays a simple
 * left/right slide. Steer-only: A/D or ← →.
 */
const CAR = CARS.bmw
const ROAD_W = 22            // asphalt width (m)
const MAX_X = ROAD_W / 2 - 1.4
const CRUISE = 52            // top cruise speed (m/s ≈ 187 km/h)
const BOOST_SPEED = 72       // ~259 km/h while boosting
const LAT_SPEED = 13         // lateral m/s — room to cross lanes quickly
const LAT_RESPONSE = 6.5     // how fast the car bites into a turn (higher = sharper)
const LAT_DRAG = 3.5         // settle rate when you let go of steering
const PLAYER_HALF_W = 1.0    // player car collision half-extents (m)
const PLAYER_HALF_L = 2.2
const HIT_COOLDOWN = 0.8     // s — stops one overlap re-triggering every frame
const SMASH_BOOST = 28       // boost meter % banked per car you ram/wreck
const DASH_PITCH = 16
const PALM_PITCH = 32          // spacing of roadside palm groups
const PALM_CAR_HEIGHTS = 4     // palm trunk+crown height as a multiple of the car's height
const MAX_STEER = 0.5          // rad — visual cap on the front-wheel turn
const SLIP_SPEED = 26          // m/s — below this the car holds the road; above, it slides wide
const SLIP_GRIP = 4.5          // slide bleed-off rate (higher = grippier)
const STEER_SPEED = 4          // m/s — no lane-changing below walking pace

// Per-frame temps (no allocations in the loop)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()
const _carPos = new THREE.Vector3(), _camPos = new THREE.Vector3(), _lookAt = new THREE.Vector3()
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion()
const _qSpin = new THREE.Quaternion(), _qSteer = new THREE.Quaternion()
const _e1 = new THREE.Euler()
const _UP = new THREE.Vector3(0, 1, 0)
const _X_AXIS = new THREE.Vector3(1, 0, 0)
const _Q_FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

/**
 * Camera presets, cycled with V (San-Andreas style, hard cuts). The car faces
 * +z, so `back` < 0 sits behind it and `back` > 0 sits on the bonnet.
 *  follow   how tightly the camera tracks the car's lateral drift
 *  lookXMul how much the aim point leans with the car
 */
const CAMS = [
    { name: 'SUNSET',  lag: 0.6, follow: 2,  height: 3.2,  back: -12, lookXMul: 0.2, lookY: 28, lookZ: 180, fov: 60 },
    { name: 'CHASE',  lag: 0.6, follow: 3,  height: 2.8,  back: -7.2, lookXMul: 0.4, lookY: 1.35, lookZ: 32, fov: 64 },
    { name: 'NEAR',   lag: 0.7, follow: 4,  height: 1.9,  back: -4.2, lookXMul: 0.5, lookY: 1.1,  lookZ: 30, fov: 70 },
    { name: 'BONNET', lag: 1.0, follow: 12, height: 1.05, back: 2.2,  lookXMul: 1.0, lookY: 1.15, lookZ: 60, fov: 82 },
]

export function SunsetScene() {
    const { camera } = useThree()
    const carRef = useRef(null)
    const brakeLightRef = useRef(null)
    const dashRef = useRef(null)
    const guideRef = useRef(null)
    const skidRef = useRef(null)
    const shadowRef = useRef(null)
    const { scene } = useGLTF(CAR.path)
    const { scene: palmScene } = useGLTF('/models/tropical_palm_tree.glb')

    // ── Car: load, align nose to +z, seat on the road, index wheels ──────────
    const { carRoot, wheels, rearWheels, frontWheels, carHeight } = useMemo(() => {
        const model = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
        model.scale.setScalar(4.4 / Math.max(size.x, size.y, size.z))
        model.rotation.y = CAR.modelYaw
        const box = new THREE.Box3().setFromObject(model)
        model.position.y = -box.min.y
        const carHeight = box.max.y - box.min.y  // world-unit height of the car, so props can size against it
        model.traverse((c) => { if (c.isMesh) c.castShadow = true })
        const carRoot = new THREE.Group(); carRoot.add(model); carRoot.updateWorldMatrix(true, true)
        const wheels = []
        model.traverse((o) => { if (CAR.wheelPattern.test(o.name)) { o.userData.base = o.quaternion.clone(); wheels.push(o) } })
        ps1CarModel(carRoot, 90, carHue) // PS1 wobble + crunchy textures + paintable hue
        const byZ = wheels.slice().sort((a, b) => a.getWorldPosition(new THREE.Vector3()).z - b.getWorldPosition(new THREE.Vector3()).z)
        return { carRoot, wheels, rearWheels: byZ.slice(0, 2), frontWheels: byZ.slice(-2), carHeight }
    }, [scene])

    // ── Scrolling props: centre dashes ───────────────────────────────────────
    const dashGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.5, 4); g.rotateX(-Math.PI / 2); return g }, [])
    const dashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#eef6ea' }), [])
    const guideGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.22, 2.8); g.rotateX(-Math.PI / 2); return g }, [])
    const guideMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e6f2d8' }), [])
    const skidGeo = useMemo(() => { const g = new THREE.PlaneGeometry(1, 2.6); g.rotateX(-Math.PI / 2); return g }, [])
    const skidMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0b0b12', transparent: true, opacity: 0.8 }), [])
    const dashN = Math.ceil(track.length / DASH_PITCH)
    const guideN = dashN * 2
    const skidMarks = useRef(Array.from({ length: 44 }, () => ({ active: false, x: 0, z: -2, rot: 0, life: 0 })))
    const wheelPoints = useMemo(() => [new THREE.Vector3(), new THREE.Vector3()], [])

    // ── Roadside palms: authored GLB models ringing the whole circuit ────────
    const palmGroupRef = useRef(null)
    const palmN = Math.ceil(track.length / PALM_PITCH) * 2
    const palms = useMemo(() => Array.from({ length: palmN }, (_, i) => {
        const side = i % 2 ? 1 : -1
        const row = Math.floor(i / 2)
        const noise = (seed) => (Math.sin(i * seed) + 1) / 2
        return {
            x: side * (ROAD_W / 2 + 3 + noise(1.71) * 8),
            s: row * PALM_PITCH + noise(2.37) * 18 - 9,
            rot: noise(3.19) * Math.PI * 2,
            sc: 0.72 + noise(4.11) * 0.52,
            lean: (noise(5.43) - 0.5) * 0.18,
            crownScale: 0.78 + noise(6.79) * 0.38,
        }
    }), [palmN])
    const palmTrees = useMemo(() => palms.map((_, i) => {
        const tree = cloneSkeleton(palmScene)
        const bounds = new THREE.Box3().setFromObject(tree)
        const height = Math.max(0.001, bounds.max.y - bounds.min.y)
        tree.userData.modelScale = (carHeight * PALM_CAR_HEIGHTS) / height
        tree.scale.setScalar(tree.userData.modelScale)
        const normalizedBounds = new THREE.Box3().setFromObject(tree)
        tree.userData.baseY = -normalizedBounds.min.y
        tree.position.y = tree.userData.baseY
        tree.traverse((child) => {
            if (!child.isMesh) return
            child.castShadow = true
            // Silhouette the palms against the sky: near-black, unlit, but keep
            // the leaf-cutout alpha from the source texture so the fronds read.
            const src = Array.isArray(child.material) ? child.material[0] : child.material
            const dark = new THREE.MeshBasicMaterial({ color: '#0a0812', fog: true })
            // Keep the source map (color→black, but its alpha channel still cuts the
            // fronds), alpha-tested so the leaf shapes stay crisp silhouettes.
            if (src?.map) { dark.map = src.map; dark.alphaTest = 0.5; dark.side = THREE.DoubleSide }
            child.material = dark
        })
        return tree
    }), [palmScene, palms, carHeight])

    // Soft radial contact shadow, kept glued to the road under the car so it
    // reads as planted — the directional shadow alone leaves it looking floaty
    // on the dark asphalt.
    const shadowTex = useMemo(() => {
        const c = document.createElement('canvas'); c.width = c.height = 128
        const g = c.getContext('2d')
        const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
        grd.addColorStop(0, 'rgba(0,0,0,0.55)')
        grd.addColorStop(0.55, 'rgba(0,0,0,0.30)')
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
        const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t
    }, [])

    const dummy = useMemo(() => new THREE.Object3D(), [])
    const state = useRef({ sPos: 0, prevS: 0, lap: 1, carX: 0, carY: 0, roll: 0, pitch: 0, yaw: 0, steer: 0, slipX: 0, lateralSpeed: 0, drift: 0, speed: 0, spin: 0, camX: 0, cam: 0, prevV: false, boost: 100, netT: 0, restX: 0, skidT: 0, shake: 0, camFwd: new THREE.Vector3(0, 0, 1), hitCooldown: [] })
    const shadowLightRef = useRef(null)

    // Road ribbon + start line, built once from the shared circuit
    const roadGeo = useMemo(() => buildRoadGeometry(ROAD_W), [])
    const startLine = useMemo(() => {
        const p = track.pointAtS(0, new THREE.Vector3())
        return { position: [p.x, 0.012, p.z], yaw: track.yawAtS(0) }
    }, [])

    // Static props: centre dashes, edge guides and palms are placed along the
    // loop once — the world no longer scrolls, the car drives around it.
    useLayoutEffect(() => {
        const p = new THREE.Vector3(), l = new THREE.Vector3()
        if (dashRef.current) {
            for (let i = 0; i < dashN; i++) {
                const s = i * DASH_PITCH
                track.pointAtS(s, p)
                dummy.position.set(p.x, 0.02, p.z)
                dummy.rotation.set(0, track.yawAtS(s), 0)
                dummy.updateMatrix()
                dashRef.current.setMatrixAt(i, dummy.matrix)
            }
            dashRef.current.instanceMatrix.needsUpdate = true
        }
        if (guideRef.current) {
            for (let i = 0; i < dashN; i++) {
                const s = i * DASH_PITCH
                track.pointAtS(s, p)
                track.leftAtS(s, l)
                for (let side = 0; side < 2; side++) {
                    const off = (side ? 1 : -1) * (ROAD_W / 2 - 0.5)
                    dummy.position.set(p.x + l.x * off, 0.02, p.z + l.z * off)
                    dummy.rotation.set(0, track.yawAtS(s), 0)
                    dummy.updateMatrix()
                    guideRef.current.setMatrixAt(side * dashN + i, dummy.matrix)
                }
            }
            guideRef.current.instanceMatrix.needsUpdate = true
        }
        if (palmGroupRef.current) {
            for (let i = 0; i < palmN; i++) {
                const palm = palms[i]
                track.pointAtS(palm.s, p)
                track.leftAtS(palm.s, l)
                const tree = palmGroupRef.current.children[i]
                const treeScale = palm.sc * palm.crownScale
                tree.position.set(p.x + l.x * palm.x, tree.userData.baseY * treeScale, p.z + l.z * palm.x)
                tree.rotation.set(0, palm.rot, palm.lean)
                tree.scale.setScalar(tree.userData.modelScale * treeScale)
            }
        }
    }, [])

    // The sun's shadow light lives in <Environment>; grab it and keep its
    // shadow box centred on the car as it laps the circuit.
    const { scene: threeScene } = useThree()
    useEffect(() => {
        let light = null
        threeScene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) light = o })
        shadowLightRef.current = light
        if (light && !light.target.parent) threeScene.add(light.target)
    }, [threeScene])

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
            }

            s.skidT -= dt
            if (braking && s.speed > 20 && s.skidT <= 0) {
                s.skidT = 0.1
                rearWheels.forEach((wheel, wheelIndex) => {
                    wheel.getWorldPosition(wheelPoints[wheelIndex])
                    const slot = skidMarks.current.find((mark) => !mark.active) || skidMarks.current[0]
                    slot.active = true
                    slot.life = 1
                    slot.x = wheelPoints[wheelIndex].x
                    slot.z = wheelPoints[wheelIndex].z
                    slot.rot = s.heading || 0
                })
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

        // Cruise, with a boost (Shift) — a LIMITED tank: it drains while held and
        // is only refilled by ramming cars (no passive regen), so takedowns are
        // the way to keep boosting. The whole drive accelerates as the track
        // builds, and the final stretch floors it toward the sun for the outro.
        const prog = session.started ? musicState.progress : 0
        const cruise = CRUISE * (1 + prog * 0.7)
        const finale = prog > 0.965
        const accelerating = session.started && (keys.KeyW || keys.ArrowUp)
        const boosting = session.started && (keys.ShiftLeft || keys.ShiftRight) && s.boost > 0
        const idle = !accelerating && !boosting && !finale && session.started
        const target = session.started
            ? (finale ? BOOST_SPEED * 2 : (boosting ? BOOST_SPEED * (1 + prog * 0.5) : cruise * (accelerating ? 1.16 : 0.45)))
            : 0
        s.speed += (target - s.speed) * Math.min(1, dt * (boosting || finale ? 1.1 : (accelerating ? 1.4 : 1.0)))
        if (idle) s.speed = THREE.MathUtils.damp(s.speed, cruise * 0.45, 2.2, dt)
        if (boosting) s.boost = Math.max(0, s.boost - 18 * dt)

        // Steer-only: A/← left, D/→ right. Camera looks down +z, so screen-left
        // is world +x — steer left (+1) must increase carX.
        const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0)
        const speedFactor = Math.min(1, s.speed / STEER_SPEED)   // parked cars can't lane-change
        const steeringLimit = LAT_SPEED * (1 - Math.min(0.35, s.speed / BOOST_SPEED * 0.35))
        const driftBias = boosting ? 0.8 + Math.min(1.4, s.speed / BOOST_SPEED * 1.6) : 0
        const lateralTarget = steer * (steeringLimit + driftBias) * speedFactor
        s.lateralSpeed = THREE.MathUtils.damp(s.lateralSpeed, lateralTarget, steer ? LAT_RESPONSE + (boosting ? 0.8 : 0) : LAT_DRAG, dt)
        s.drift = THREE.MathUtils.damp(s.drift, boosting && steer !== 0 ? steer * (0.42 + s.speed / BOOST_SPEED * 0.4) : 0, boosting ? 4.5 : 7.2, dt)

        // Grip: the tyres hold the road up to SLIP_SPEED; beyond that the car
        // slides wide through corners and the slip bleeds off as it hooks up.
        track.pointAtS(s.sPos, _v1)
        track.leftAtS(s.sPos, _v2)
        track.tangentAtS(s.sPos, _v3)
        const tangentYaw = Math.atan2(_v3.x, _v3.z)
        let yawErr = tangentYaw - (s.yaw || tangentYaw)
        if (yawErr > Math.PI) yawErr -= Math.PI * 2
        if (yawErr < -Math.PI) yawErr += Math.PI * 2
        const slideIn = Math.max(0, s.speed - SLIP_SPEED) * Math.sin(yawErr)
        s.slipX = THREE.MathUtils.damp(s.slipX + slideIn * dt, 0, SLIP_GRIP, dt)
        const cornerSlip = slideIn * 0.25

        if (steer !== 0) {
            s.restX = s.carX
            const driftPush = boosting ? s.drift * 1.15 : 0
            s.carX = THREE.MathUtils.clamp(s.carX + (s.lateralSpeed + driftPush + s.slipX + cornerSlip) * dt, -MAX_X, MAX_X)
        } else {
            s.carX = THREE.MathUtils.clamp(s.carX + (s.slipX + cornerSlip) * dt, -MAX_X, MAX_X)
            // When you let go, ease back toward the last offset you were holding,
            // not to the literal center. This makes the car feel like it settles
            // after a burst of acceleration or a quick lane change.
            s.carX = THREE.MathUtils.damp(s.carX, s.restX, 2.0, dt)
            s.drift = THREE.MathUtils.damp(s.drift, 0, 5.5, dt)
        }
        if (Math.abs(s.carX) >= MAX_X) s.lateralSpeed = 0

        // Traffic: ram a small car to WRECK it and bank boost (a takedown);
        // trucks & buses are heavy obstacles that just scrape your speed off, so
        // you want to dodge them. Each car has a cooldown so one overlap doesn't
        // re-trigger every frame.
        if (session.started) {
            for (let i = 0; i < trafficBoxes.length; i++) {
                if ((s.hitCooldown[i] || 0) > 0) { s.hitCooldown[i] -= dt; continue }
                const box = trafficBoxes[i]
                if (box.smash) continue
                const dx = s.carX - box.x
                const dz = track.deltaS(s.sPos, box.s)
                if (Math.abs(dx) < PLAYER_HALF_W + box.halfWidth && Math.abs(dz) < PLAYER_HALF_L + box.halfLen) {
                    s.hitCooldown[i] = HIT_COOLDOWN
                    if (box.big) {
                        // Truck/bus scrape: bleed speed and get kicked out of its lane.
                        s.speed *= 0.5
                        const kickDir = dx !== 0 ? Math.sign(dx) : (i % 2 ? 1 : -1)
                        s.carX = THREE.MathUtils.clamp(s.carX + kickDir * 3.2, -MAX_X, MAX_X)
                        s.restX = s.carX
                        s.shake = 1
                    } else {
                        // Takedown: wreck the car (Traffic.jsx launches it) and bank boost.
                        box.smash = true
                        s.boost = Math.min(100, s.boost + SMASH_BOOST)
                        s.speed *= 0.9
                        s.shake = 0.55
                    }
                }
            }
        }

        // Advance along the loop and count laps across the start/finish line.
        if (session.started) {
            s.prevS = s.sPos
            s.sPos = track.wrap(s.sPos + s.speed * dt)
            if (s.prevS > track.length * 0.75 && s.sPos < track.length * 0.25) s.lap++
        }
        s.carY = THREE.MathUtils.damp(s.carY, 0, boosting ? 1.8 : 5.5, dt)
        // Car transform: arc position + lateral offset along the loop. The nose
        // chases the track tangent with lag (understeer) instead of being locked
        // to it — cornering reads as the car turning in, not pivoting on rails.
        // (track lookups + yawErr come from the grip block above)
        const dy = yawErr
        s.yaw = (s.yaw || tangentYaw) + dy * Math.min(1, dt * 3.4)
        s.heading = s.yaw
        _carPos.set(_v1.x + _v2.x * s.carX, s.carY, _v1.z + _v2.z * s.carX)
        const turn = s.lateralSpeed / LAT_SPEED
        if (carRef.current) {
            carRef.current.position.copy(_carPos)
            s.roll = THREE.MathUtils.damp(s.roll, -turn * 0.3 - s.drift * 0.06, 11, dt)
            s.pitch = THREE.MathUtils.damp(s.pitch, boosting ? -0.05 : accelerating ? -0.025 : 0, boosting ? 2.2 : 6, dt)
            // RWD feel: the nose points where the front wheels steer; mid-drift
            // the rear steps out, yawing the body a touch further than the nose.
            _q1.setFromAxisAngle(_UP, s.yaw - s.drift * 0.12)
            _q2.setFromEuler(_e1.set(s.pitch, 0, s.roll))
            carRef.current.quaternion.copy(_q1).multiply(_q2)
        }
        // Front wheels steer toward the input + corner; rears just roll.
        const steerTarget = THREE.MathUtils.clamp(Math.atan2((s.lateralSpeed + s.drift * 2) * 0.55, Math.max(8, s.speed)) + dy * 1.2, -MAX_STEER, MAX_STEER)
        s.steer = THREE.MathUtils.damp(s.steer, steerTarget, 9, dt)
        // Contact shadow: glued to the road under the car (independent of the
        // car's own lift), growing and fading as it rises on boost.
        if (shadowRef.current) {
            shadowRef.current.position.set(_carPos.x, 0.015, _carPos.z)
            shadowRef.current.quaternion.copy(_q1).multiply(_Q_FLAT)
            const lift = Math.max(0, s.carY)
            shadowRef.current.scale.setScalar(1 + lift * 0.35)
            shadowRef.current.material.opacity = THREE.MathUtils.clamp(1 - lift * 0.45, 0.3, 1)
        }
        s.spin += (s.speed / 0.34) * dt
        _qSpin.setFromAxisAngle(_X_AXIS, s.spin)
        _qSteer.setFromAxisAngle(_UP, s.steer)
        for (const w of rearWheels) w.quaternion.copy(w.userData.base).multiply(_qSpin)
        for (const w of frontWheels) w.quaternion.copy(w.userData.base).multiply(_qSteer).multiply(_qSpin)

        // Keep the sun's shadow box centred on the car as it laps the circuit
        if (shadowLightRef.current) {
            shadowLightRef.current.position.set(_carPos.x + 30, _carPos.y + 30, _carPos.z + 140)
            shadowLightRef.current.target.position.copy(_carPos)
        }

        // Camera: cycle presets on V (edge-detected), then place it. Hard cuts.
        if (keys.KeyV && !s.prevV) s.cam = (s.cam + 1) % CAMS.length
        s.prevV = !!keys.KeyV
        const C = CAMS[s.cam]
        s.camX += (s.carX * C.lag - s.camX) * Math.min(1, dt * C.follow)

        // Smoothed chase forward — the camera sweeps through corners instead of
        // snapping to the tangent. Tracks tighter as speed builds, so fast
        // corners don't leave the car out of frame.
        s.camFwd.lerp(_v3, Math.min(1, dt * (2.6 + (s.speed / CRUISE) * 1.8))).normalize()

        // Hit shake only: a brief scattered jitter when you scrape traffic (set
        // by the collision check above). Boosting no longer shakes the camera.
        s.shake = THREE.MathUtils.damp(s.shake, 0, 6, dt)
        const shakeAmp = s.shake * 0.26
        const jx = (Math.random() - 0.5) * shakeAmp
        const jy = (Math.random() - 0.5) * shakeAmp * 0.7
        const jz = (Math.random() - 0.5) * shakeAmp * 0.5

        const back = C.back
        _camPos.copy(_carPos)
            .addScaledVector(s.camFwd, back)
            .addScaledVector(_v2, s.camX - s.carX)
        camera.position.set(_camPos.x + jx, _camPos.y + C.height + s.carY * 0.6 + jy, _camPos.z + jz)

        // Every cam aims along the track now — the sun comes into frame
        // naturally whenever the loop points toward it.
        _lookAt.copy(_carPos)
            .addScaledVector(s.camFwd, C.lookZ)
            .addScaledVector(_v2, s.carX * (C.lookXMul - 1) + jx * 1.5)
        _lookAt.y += C.lookY + s.carY + jy * 1.5
        camera.lookAt(_lookAt)
        camera.rotation.z += (Math.random() - 0.5) * shakeAmp * 0.05
        if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix() }

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

        drive.kmh = Math.round(s.speed * 3.6)
        drive.cam = C.name
        drive.boost = s.boost / 100
        drive.gap = gap
        drive.flight = accelerating || boosting
        drive.s = s.sPos
        drive.lap = s.lap
    })

    return (
        <>
            {/* Teal dusk sky + image-based lighting — the original retro mood */}
            <Environment preset="sunset" />

            {/* Ground apron under the whole circuit + the road ribbon itself */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
                <planeGeometry args={[2400, 2400]} />
                <meshStandardMaterial color="#356b32" roughness={1} />
            </mesh>
            <mesh geometry={roadGeo} receiveShadow>
                <meshStandardMaterial color="#22352b" roughness={0.92} />
            </mesh>
            {/* Start/finish line */}
            <group position={startLine.position} rotation={[0, startLine.yaw, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[ROAD_W - 1, 2.5]} />
                    <meshBasicMaterial color="#eef6ea" />
                </mesh>
            </group>
            <instancedMesh ref={dashRef} args={[dashGeo, dashMat, dashN]} frustumCulled={false} />
            <instancedMesh ref={guideRef} args={[guideGeo, guideMat, guideN]} frustumCulled={false} />
            <group ref={palmGroupRef}>
                {palmTrees.map((tree, i) => <primitive key={i} object={tree} />)}
            </group>

            {/* Soft contact shadow, grounded on the road under the car */}
            <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
                <planeGeometry args={[3.4, 6]} />
                <meshBasicMaterial map={shadowTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>

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
