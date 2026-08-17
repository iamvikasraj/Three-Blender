import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import { initPhysics, stepPhysics, eventQueue, world } from './physics.js'
import { buildWorld, ROAD } from './world.js'
import { Vehicle, TUNING, CARS } from './vehicle.js'
import { ChaseCamera, SpeedLines, RadialBlurShader, BLUR_MAX } from './cameraFX.js'
import { Traffic } from './traffic.js'
import { CrashDirector } from './crash.js'
import { dent } from './deform.js'
import { loadCircuit, findRoadSurface, findSpawnOnRoad, probeGround } from './circuit.js'

/**
 * Burnout-style prototype — orchestration.
 * Systems: physics (Rapier + time dilation), vehicle (arcade raycast car),
 * cameraFX (chase/FOV/shake/speed-lines/radial blur), traffic (checking),
 * crash (kept for later modes; walls currently only bleed speed), deform.
 *
 *  SCRAPE_DELTA_V  velocity loss in one physics step that reads as a wall hit
 *  SCRAPE_PENALTY  extra speed kept after a wall hit (0.55 = lose ~45%)
 */
const SCRAPE_DELTA_V = 6
const SCRAPE_PENALTY = 0.55

/** true = drive the real Burnout Revenge circuit; false = procedural highway. */
const USE_CIRCUIT = true

const canvas = document.querySelector('canvas.webgl')
const loadingEl = document.querySelector('.loading')
const kmhEl = document.querySelector('#kmh')
const boostBox = document.querySelector('#boost')
const boostFill = document.querySelector('#boost-fill')
const banner = document.querySelector('#crash-banner')

const sizes = { width: window.innerWidth, height: window.innerHeight }
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, sizes.width / sizes.height, 0.1, 2600) // far enough to see the sky dome + sun
scene.add(camera)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

const composer = new EffectComposer(renderer)
composer.setSize(sizes.width, sizes.height)
composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
composer.addPass(new RenderPass(scene, camera))
const blurPass = new ShaderPass(RadialBlurShader)
composer.addPass(blurPass)
composer.addPass(new OutputPass())

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    composer.setSize(sizes.width, sizes.height)
})

// ── Input ────────────────────────────────────────────────────────────────────
const keys = {}
window.addEventListener('keydown', (e) => {
    keys[e.code] = true
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })

// ── Boot ─────────────────────────────────────────────────────────────────────
await initPhysics()

// The Eternal City's textures are baked for daylight, so it gets the bright
// preset; the procedural highway keeps the synthwave dusk.
buildWorld(scene, { road: !USE_CIRCUIT, sky: USE_CIRCUIT ? 'daylight' : 'sunset' })

let circuit = null
if (USE_CIRCUIT) {
    if (loadingEl) loadingEl.textContent = 'Loading circuit…'
    circuit = await loadCircuit(scene)
    console.log(`[CIRCUIT] ${circuit.triangles} tris, scale ${circuit.scale.toFixed(2)},`,
        'bounds', circuit.bounds.min.toArray().map((n) => n.toFixed(0)).join(','),
        '→', circuit.bounds.max.toArray().map((n) => n.toFixed(0)).join(','))
}

const vehicle = new Vehicle(CARS.r190) // swap to CARS.bmw for the M3 GTR
await vehicle.load(scene)
let spawnPoint = null

// Seat the car on the circuit surface
if (circuit) {
    const road = findRoadSurface(circuit.root)
    if (road) console.log(`[CIRCUIT] road surface: ${Math.round(road.area)} m², ${road.points.length} tris`)
    spawnPoint = findSpawnOnRoad(road)
    if (spawnPoint) {
        console.log('[CIRCUIT] spawn', spawnPoint)
        vehicle.body.setTranslation({ x: spawnPoint.x, y: spawnPoint.y + 1.6, z: spawnPoint.z }, true)
        // Face down the road so the chase camera looks along it
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawnPoint.heading)
        vehicle.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
        vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    } else {
        console.warn('[CIRCUIT] no road spawn found — using default position')
    }
}
loadingEl?.classList.add('is-hidden')

const chaseCam = new ChaseCamera(camera)
const speedLines = new SpeedLines(camera)
const traffic = new Traffic()
if (!USE_CIRCUIT) traffic.build(scene) // lane traffic is highway-only for now
const crash = new CrashDirector(scene, vehicle, chaseCam, banner)
if (spawnPoint) {
    // R / respawn returns to the road spawn rather than the highway default
    crash.safe.pos.set(spawnPoint.x, spawnPoint.y + 0.6, spawnPoint.z)
    crash.safe.heading = spawnPoint.heading
}

// ── Loop ─────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock()
let prevSpeed = 0
let totalDist = 0 // metres driven — ramps the difficulty (traffic gap tightens)

const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.05)

    // Read input → vehicle
    vehicle.input.throttle = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0
    vehicle.input.steer = (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0
    vehicle.input.handbrake = !!keys.Space
    vehicle.input.boost = !!keys.ShiftLeft || !!keys.ShiftRight
    if (keys.KeyR && !crash.active) crash.respawn()

    // Aftertouch while crashed (steer the tumble)
    if (crash.active) {
        crash.aftertouch(
            (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0,
            (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0,
            dt,
        )
    }

    // Physics (fixed substeps; vehicle forces applied per substep)
    prevSpeed = Math.abs(vehicle.speed)
    stepPhysics(dt, (fixed) => vehicle.substep(fixed))

    // Collision events → traffic checking / crashes
    eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started || crash.active) return
        const other = h1 === vehicle.collider.handle ? h2 : h2 === vehicle.collider.handle ? h1 : null
        if (other === null) return
        const car = traffic.byCollider.get(other)
        if (!car) return
        const mid = vehicle.position().lerp(car.mesh.position, 0.5)
        const result = traffic.handleHit(car, vehicle)
        if (result === 'checked') {
            dent(vehicle.model, mid, 0.5, 0.06)
            vehicle.boostMeter = Math.min(100, vehicle.boostMeter + TUNING.boostOnCheck)
        } else if (result === 'crash') {
            dent(vehicle.model, mid, 0.8, 0.16)
            crash.trigger(mid)
        }
    })

    // Wall scrape: hard hits bleed speed (plus sparks + a dent) instead of
    // triggering the crash state — keeps the run flowing.
    if (!crash.active && vehicle.controlEnabled) {
        const drop = prevSpeed - Math.abs(vehicle.speed)
        if (drop > SCRAPE_DELTA_V && prevSpeed > 12) {
            const impact = vehicle.position().add(vehicle.forward().multiplyScalar(1.5))
            dent(vehicle.model, impact, 0.6, 0.08)
            crash.sparksAt(impact)
            const v = vehicle.body.linvel()
            vehicle.body.setLinvel({ x: v.x * SCRAPE_PENALTY, y: v.y, z: v.z * SCRAPE_PENALTY }, true)
        }
    }

    // Endless road: wrap everything back by one period (highway only — the
    // circuit is a closed loop, so there's nothing to wrap)
    const pz = vehicle.position().z
    if (!USE_CIRCUIT && !crash.active && Math.abs(pz) > 1300) {
        const dz = -Math.sign(pz) * ROAD.WRAP
        const b = vehicle.body
        const t = b.translation()
        b.setTranslation({ x: t.x, y: t.y, z: t.z + dz }, true)
        crash.safe.pos.z += dz
        for (const car of traffic.cars) {
            const ct = car.body.translation()
            car.body.setTranslation({ x: ct.x, y: ct.y, z: ct.z + dz }, true)
        }
    }

    // Systems — difficulty eases you in, then tightens the traffic over ~5 km
    totalDist += Math.abs(vehicle.speed) * dt
    const difficulty01 = Math.min(1, totalDist / 5000)
    vehicle.syncVisual(dt)
    if (!USE_CIRCUIT) traffic.update(performance.now() / 1000, vehicle.position().z, difficulty01)
    crash.recordSafe(dt)
    crash.update(dt)
    chaseCam.update(dt, vehicle, vehicle.boosting)
    speedLines.update(dt, vehicle.speed01, vehicle.boosting)

    // Post FX strength follows speed + boost
    blurPass.uniforms.uStrength.value =
        Math.max(0, vehicle.speed01 - 0.55) * BLUR_MAX * 1.6 + (vehicle.boosting ? BLUR_MAX * 0.5 : 0)

    // HUD
    if (kmhEl) kmhEl.textContent = Math.round(Math.abs(vehicle.speed) * 3.6)
    if (boostFill) boostFill.style.transform = `scaleX(${vehicle.boostMeter / 100})`
    boostBox?.classList.toggle('is-active', vehicle.boosting)

    composer.render()
    window.requestAnimationFrame(tick)
}

tick()
