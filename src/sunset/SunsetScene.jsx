import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildTrack } from '../game/trackBuilder.js'
import { CARS } from '../game/constants.js'
import { keys } from '../game/input.js'
import { drive } from './hudState.js'
import { Retro } from './Retro.jsx'
import { MapEnvironment } from './MapEnvironment.jsx'
import { ps1CarModel, ps1Material } from './ps1.js'
import { carHue, PAINTS } from './paint.js'
import { session, bumpDistance } from './session.js'
import { updateAudio } from './audio.js'

/**
 * Lap the circuit. The road is extruded from the map's closed centerline; the
 * car auto-throttles ALONG the track (its distance advances) while you steer to
 * set a lateral offset within the road. Drifting onto the verge scrubs speed.
 * Steer-only: A/D or ← →. A real chase cam follows around the bends.
 */
const CAR = CARS.bmw
const ROAD_W = 14
const HALF = ROAD_W / 2

// Arcade driving tune (all m, s).
const MAX_SPEED = 74, BOOST_SPEED = 96
const ENGINE_ACCEL = 26, BOOST_ACCEL = 18, BRAKE_DECEL = 54, DRAG = 10, REVERSE_MIN = -9
const STEER_FORCE = 95, GRIP = 6, DRIFT_GRIP = 1.1, OFFROAD = 0.5
const BOOST_FILL = 28, BOOST_DRAIN = 42

const CAMS = [
    { name: 'CHASE',  back: -12, height: 5.0, lookZ: 22, lookY: 1.4, fov: 66, ease: 0.006 },
    { name: 'NEAR',   back: -7,  height: 3.2, lookZ: 16, lookY: 1.2, fov: 72, ease: 0.004 },
    { name: 'BONNET', back: 2.2, height: 1.1, lookZ: 34, lookY: 1.1, fov: 82, ease: 0.0015 },
]

const _pt = new THREE.Vector3()
const _tan = new THREE.Vector3()
const _tan2 = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _axis = new THREE.Vector3(1, 0, 0)

export function SunsetScene({ map }) {
    const { camera } = useThree()
    const carRef = useRef(null)
    const propRef = useRef(null)
    const { scene } = useGLTF(CAR.path)

    // ── Car ──────────────────────────────────────────────────────────────────
    const { carRoot, wheels } = useMemo(() => {
        const model = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
        model.scale.setScalar(4.4 / Math.max(size.x, size.y, size.z))
        model.rotation.y = CAR.modelYaw
        model.position.y = -new THREE.Box3().setFromObject(model).min.y
        model.traverse((c) => { if (c.isMesh) c.castShadow = true })
        const carRoot = new THREE.Group(); carRoot.add(model); carRoot.updateWorldMatrix(true, true)
        const wheels = []
        model.traverse((o) => { if (CAR.wheelPattern.test(o.name)) { o.userData.base = o.quaternion.clone(); wheels.push(o) } })
        ps1CarModel(carRoot, 90, carHue)
        return { carRoot, wheels }
    }, [scene])

    // ── Circuit: extrude the loop into road + centre dashes, keep the curve ──
    const track = useMemo(() => buildTrack({ points: map.loop, roadWidth: ROAD_W, wallHeight: 0.1, samples: 1000 }), [map])
    const length = useMemo(() => track.curve.getLength(), [track])

    const roadMat = useMemo(() => ps1Material(new THREE.MeshBasicMaterial({ color: map.road, side: THREE.DoubleSide }), 130), [map])
    const dashMat = useMemo(() => ps1Material(new THREE.MeshBasicMaterial({ color: map.dash }), 130), [map])

    // ── Roadside props sampled along the track ───────────────────────────────
    const prop = useMemo(() => {
        if (map.prop === 'palm') {
            const trunk = new THREE.CylinderGeometry(0.18, 0.34, 5, 6); trunk.translate(0, 2.5, 0)
            const top = new THREE.ConeGeometry(2.4, 1.5, 7); top.translate(0, 5.3, 0)
            return { geo: mergeGeometries([trunk, top]), mat: ps1Material(new THREE.MeshBasicMaterial({ color: '#0a0a14' }), 90), y: 0, side: HALF + 6 }
        }
        const geo = new THREE.BoxGeometry(0.4, 5, 0.4)
        const mat = ps1Material(new THREE.MeshStandardMaterial({ color: '#06150f', emissive: '#4fd8a0', emissiveIntensity: 2.2, roughness: 0.4 }), 90)
        return { geo, mat, y: 2.5, side: HALF + 4 }
    }, [map])

    const propData = useMemo(() => {
        const n = Math.max(12, Math.floor(length / 46))
        const arr = []
        for (let i = 0; i < n; i++) {
            const t = i / n
            const p = track.curve.getPointAt(t, _pt)
            const tan = track.curve.getTangentAt(t, _tan); tan.y = 0; tan.normalize()
            const nx = tan.z, nz = -tan.x
            arr.push([p.x + nx * prop.side, p.z + nz * prop.side])
            arr.push([p.x - nx * prop.side, p.z - nz * prop.side])
        }
        return arr
    }, [track, length, prop])

    useEffect(() => {
        if (!propRef.current) return
        const m = new THREE.Object3D()
        propData.forEach((p, i) => { m.position.set(p[0], prop.y, p[1]); m.updateMatrix(); propRef.current.setMatrixAt(i, m.matrix) })
        propRef.current.instanceMatrix.needsUpdate = true
    }, [propData, prop])

    const state = useRef({ carX: 0, latV: 0, speed: 0, trackDist: 0, boost: 100, spin: 0, cam: 0, prevV: false, paint: 0, prevC: false, camReady: false })

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05)
        const s = state.current
        if (!carRef.current) return
        const on = session.started
        const L = length

        // ── Input ────────────────────────────────────────────────────────────
        const throttle = on && (keys.KeyW || keys.ArrowUp)
        const braking = on && (keys.KeyS || keys.ArrowDown)
        const steer = on ? (((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0)) : 0
        const drifting = on && !!keys.Space && Math.abs(s.speed) > 8
        const boosting = on && (keys.ShiftLeft || keys.ShiftRight) && s.boost > 0 && s.speed > 6

        // ── Sample the track at the car + a little ahead (for curvature) ──────
        const t = (((s.trackDist % L) + L) % L) / L
        const p = track.curve.getPointAt(t, _pt)
        const tan = track.curve.getTangentAt(t, _tan); tan.y = 0; tan.normalize()
        const nx = tan.z, nz = -tan.x
        const t2 = (((s.trackDist + 7) % L + L) % L) / L
        const tan2 = track.curve.getTangentAt(t2, _tan2); tan2.y = 0; tan2.normalize()
        const dotN = (tan2.x - tan.x) * nx + (tan2.z - tan.z) * nz  // how the road turns

        // ── Speed: throttle / brake / drag, verge is slow ────────────────────
        const offRoad = Math.abs(s.carX) > HALF
        const maxSpeed = (boosting ? BOOST_SPEED : MAX_SPEED) * (offRoad ? OFFROAD : 1)
        if (throttle) s.speed += (ENGINE_ACCEL + (boosting ? BOOST_ACCEL : 0)) * dt
        else if (braking) s.speed -= BRAKE_DECEL * dt
        else s.speed -= DRAG * dt
        if (offRoad) s.speed -= DRAG * 1.6 * dt
        s.speed = THREE.MathUtils.clamp(s.speed, REVERSE_MIN, maxSpeed)

        // ── Lateral: steering vs grip vs the corner's centrifugal push ───────
        const grip = drifting ? DRIFT_GRIP : GRIP
        const cf = -(dotN / 7) * s.speed * s.speed
        s.latV += (cf + steer * STEER_FORCE - grip * s.latV) * dt
        s.carX += s.latV * dt
        if (Math.abs(s.carX) >= HALF + 8) { s.carX = THREE.MathUtils.clamp(s.carX, -(HALF + 8), HALF + 8); s.latV *= 0.3 }

        // ── Boost meter: drift to fill, hold Shift to spend ──────────────────
        if (boosting) s.boost = Math.max(0, s.boost - BOOST_DRAIN * dt)
        else s.boost = Math.min(100, s.boost + (drifting ? BOOST_FILL : 4) * dt)

        s.trackDist += s.speed * dt

        // ── Car transform: slide the nose out by the slip angle (the drift) ──
        const slip = Math.atan2(s.latV, Math.max(Math.abs(s.speed), 6))
        const heading = Math.atan2(tan.x, tan.z)
        const car = carRef.current
        car.position.set(p.x + nx * s.carX, 0, p.z + nz * s.carX)
        car.rotation.set(0, heading + slip * 0.9, 0)
        car.rotation.z = -THREE.MathUtils.clamp(slip * 0.6 + steer * 0.05, -0.4, 0.4)

        s.spin += (s.speed / 0.34) * dt
        const q = new THREE.Quaternion().setFromAxisAngle(_axis, s.spin)
        for (const w of wheels) w.quaternion.copy(w.userData.base).multiply(q)

        // ── Chase camera along the tangent ───────────────────────────────────
        if (keys.KeyV && !s.prevV) s.cam = (s.cam + 1) % CAMS.length
        s.prevV = !!keys.KeyV
        const C = CAMS[s.cam]
        _tmp.set(car.position.x + tan.x * C.back, C.height, car.position.z + tan.z * C.back)
        if (!s.camReady) { camera.position.copy(_tmp); s.camReady = true }
        else camera.position.lerp(_tmp, 1 - Math.pow(C.ease, dt))
        camera.lookAt(car.position.x + tan.x * C.lookZ, C.lookY, car.position.z + tan.z * C.lookZ)
        if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix() }

        if (keys.KeyC && !s.prevC) { s.paint = (s.paint + 1) % PAINTS.length; carHue.value = PAINTS[s.paint].hue }
        s.prevC = !!keys.KeyC

        if (on) bumpDistance(Math.max(0, s.speed) * dt)
        updateAudio(Math.min(1, Math.abs(s.speed) / MAX_SPEED), boosting)

        drive.kmh = Math.round(Math.abs(s.speed) * 3.6)
        drive.cam = C.name
        drive.paint = PAINTS[s.paint].name
        drive.boost = s.boost / 100
        drive.lap = Math.floor(Math.max(0, s.trackDist) / L) + 1
    })

    return (
        <>
            <MapEnvironment map={map} />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
                <planeGeometry args={[8000, 8000]} />
                <meshBasicMaterial color={map.ground} />
            </mesh>
            <mesh geometry={track.roadGeo} material={roadMat} />
            <mesh geometry={track.edgeGeo} material={dashMat} />
            <mesh geometry={track.lineGeo} material={dashMat} />
            <instancedMesh key={map.id} ref={propRef} args={[prop.geo, prop.mat, propData.length]} frustumCulled={false} />

            <group ref={carRef}>
                <primitive object={carRoot} />
            </group>

            <Retro />
        </>
    )
}

useGLTF.preload(CAR.path)
