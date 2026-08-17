import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { world, RAPIER } from './physics.js'

/**
 * Arcade vehicle on Rapier's DynamicRayCastVehicleController.
 *
 * ── KEY TUNABLES ─────────────────────────────────────────────────────────────
 *  enginePower   engine force (N) on the rear wheels — raw acceleration
 *  maxSpeed      soft cap m/s without boost (72 ≈ 260 km/h)
 *  steerMax      wheel lock (rad) at standstill; falls off with speed
 *  steerFalloff  how fast lock shrinks with speed (higher = calmer at speed)
 *  grip/sideGrip normal tyre grip (frictionSlip / sideFrictionStiffness)
 *  driftGripRear rear grip while the handbrake is held — LOWER = bigger slides
 *  driftYawKick  extra yaw torque during drift — the exaggerated arcade rotation
 *  boostAccel    extra acceleration (m/s²) while boosting
 *  boostDrain/Regen/OnCheck  boost meter economy (0–100)
 */
export const TUNING = {
    // ── Burnout-style arcade feel ────────────────────────────────────────────
    // Light, punchy and always steerable. The car should change direction NOW,
    // never wallow, and never feel like it's carrying realistic weight.
    mass: 1000,              // substantial like the real game, not featherweight
    enginePower: 14000,      // strong pull without being violent
    brakeForce: 55,
    maxSpeed: 56,            // ~200 km/h — real-game pace, actually controllable
    boostMaxSpeed: 72,       // ~260 km/h on boost
    // Steering stays usable at speed (the original 0.055 falloff collapsed the
    // lock to ~6° flat out and felt like a truck), but calm enough to hold a
    // line instead of darting.
    steerMax: 0.55,
    steerFalloff: 0.026,     // ~13° of lock at top speed
    steerLerp: 15,           // responsive, still smooth
    // Firm but not rigid — the car settles instead of floating or skittering
    suspension: { rest: 0.3, stiffness: 58, compression: 3.2, relaxation: 4.0, travel: 0.2 },
    grip: 4.4,               // planted, with a little slide available
    // Lateral grip. This is the dial that stops the car sliding while merely
    // steering — too low and it drifts through every corner unintentionally.
    sideGrip: 3.2,
    driftGripRear: 0.55,     // lower rear grip → bigger, easier slides
    driftSideRear: 0.14,
    driftYawKick: 560,       // exaggerated arcade rotation into the drift
    boostAccel: 18,
    boostDrain: 30,
    boostRegen: 13,
    boostOnCheck: 30,
}

const HALF = { w: 0.92, h: 0.5, l: 2.2 } // chassis half-extents (m)

/**
 * Car registry. Each rip names its parts differently and faces a different way,
 * so every car declares how to find its wheels and which way its nose points.
 *  wheelPattern  matches the four wheel PARENT nodes (GLTFLoader strips dots,
 *                so `foo.001` arrives as `foo001`)
 *  modelYaw      rotation to bring the model's nose onto the rig's +Z forward
 */
export const CARS = {
    r190: {
        name: 'Factory R190 GT',
        path: '/models/cars/factory_r190_gt_burnout_revenge.glb',
        wheelPattern: /^Car1C_mesh_9\d{0,3}$/, // mesh_9, _9001, _9002, _9003
        modelYaw: 0, // model nose is already +Z (rear wing sits at −Z)
        // Car-select stats + per-car handling overrides (merged over TUNING)
        stats: { weight: 'LIGHT', boostMph: 209, crashbreaker: 'FORCE 1' },
        tuning: { mass: 950, grip: 4.4, sideGrip: 3.2, maxSpeed: 56, boostMaxSpeed: 72 },
    },
    bmw: {
        name: 'BMW M3 GTR',
        path: '/models/bmw_m3_gtr_-_nfs_mw.glb',
        wheelPattern: /^wheel\d*$/,
        modelYaw: Math.PI, // model nose is −Z
        stats: { weight: 'MEDIUM', boostMph: 196, crashbreaker: 'FORCE 2' },
        tuning: { mass: 1100, grip: 4.8, sideGrip: 3.5, maxSpeed: 53, boostMaxSpeed: 68 },
    },
}

export class Vehicle {
    constructor(car = CARS.bmw) {
        this.car = car
        this.group = new THREE.Group()   // physics-driven root
        this.model = null
        this.wheels = []
        this.wheelSpin = 0
        this.wheelRadius = 0.34 // derived from the model in load()
        this.steerVisual = 0
        this.input = { throttle: 0, steer: 0, handbrake: false, boost: false }
        this.boostMeter = 100
        this.boosting = false
        this.controlEnabled = true
        this.speed = 0        // signed forward m/s
        this.speed01 = 0
    }

    async load(scene, loadingManager) {
        // Per-car handling overrides (weight class, grip, top speed)
        Object.assign(TUNING, this.car.tuning ?? {})

        // Physics body
        this.body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(-2.2, 1.4, 0).setCanSleep(false),
        )
        // Arcade stability: only yaw is free — the car can never roll or flip
        this.body.setEnabledRotations(false, true, false, true)
        this.collider = world.createCollider(
            RAPIER.ColliderDesc.cuboid(HALF.w, HALF.h, HALF.l)
                .setMass(TUNING.mass)
                .setFriction(0.4)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            this.body,
        )

        // Raycast vehicle controller: 4 wheels, front pair steers, rear pair drives
        this.controller = world.createVehicleController(this.body)
        const s = TUNING.suspension
        const positions = [
            { x: -0.8, y: -0.1, z: 1.32 },  // 0 front-left
            { x: 0.8, y: -0.1, z: 1.32 },   // 1 front-right
            { x: -0.8, y: -0.1, z: -1.32 }, // 2 rear-left
            { x: 0.8, y: -0.1, z: -1.32 },  // 3 rear-right
        ]
        positions.forEach((p, i) => {
            this.controller.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.rest, 0.34)
            this.controller.setWheelSuspensionStiffness(i, s.stiffness)
            this.controller.setWheelSuspensionCompression(i, s.compression)
            this.controller.setWheelSuspensionRelaxation(i, s.relaxation)
            this.controller.setWheelMaxSuspensionTravel(i, s.travel)
            this.controller.setWheelFrictionSlip(i, TUNING.grip)
            this.controller.setWheelSideFrictionStiffness(i, TUNING.sideGrip)
        })

        // Visual: load the selected car and align its nose with the rig's +Z
        const gltf = await new Promise((res, rej) =>
            new GLTFLoader(loadingManager).load(this.car.path, res, undefined, rej))
        this.model = gltf.scene
        const box = new THREE.Box3().setFromObject(this.model)
        const size = box.getSize(new THREE.Vector3())
        const scale = (HALF.l * 2) / Math.max(size.x, size.y, size.z)
        this.model.scale.setScalar(scale)
        this.model.rotation.y = this.car.modelYaw
        const box2 = new THREE.Box3().setFromObject(this.model)
        this.model.position.y = -(HALF.h + TUNING.suspension.rest * 0.9) - box2.min.y
        this.model.traverse((c) => { if (c.isMesh) { c.castShadow = true } })
        this.group.add(this.model)
        scene.add(this.group)

        // Wheel nodes — each car declares its own naming pattern
        this.model.updateWorldMatrix(true, true)
        this.model.traverse((o) => { if (this.car.wheelPattern.test(o.name)) this.wheels.push(o) })
        const centers = this.wheels.map((w) => this.group.worldToLocal(
            new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3())))
        this.wheels.forEach((w, i) => {
            w.userData.base = w.quaternion.clone()
            w.userData.front = centers[i].z > 0 // group-forward is +Z
            w.userData.steerAxis = new THREE.Vector3(0, 1, 0)
                .applyQuaternion(w.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
                .normalize()
        })
        // Roll radius from the actual wheel geometry (vertical extent / 2)
        if (this.wheels.length) {
            const ws = new THREE.Box3().setFromObject(this.wheels[0]).getSize(new THREE.Vector3())
            this.wheelRadius = Math.max(ws.y, ws.z) / 2 || this.wheelRadius
        }
        console.log(`[CAR] ${this.car.name}: ${this.wheels.length} wheels, r=${this.wheelRadius.toFixed(2)}m`)
    }

    /** Re-push suspension settings (call after changing them in the GUI). */
    applySuspension() {
        if (!this.controller) return
        const s = TUNING.suspension
        for (let i = 0; i < 4; i++) {
            this.controller.setWheelSuspensionStiffness(i, s.stiffness)
            this.controller.setWheelSuspensionCompression(i, s.compression)
            this.controller.setWheelSuspensionRelaxation(i, s.relaxation)
            this.controller.setWheelMaxSuspensionTravel(i, s.travel)
        }
    }

    /** Runs before every physics substep (fixed dt). */
    substep(dt) {
        if (!this.controller) return
        const t = TUNING
        const vel = this.body.linvel()
        const rot = this.body.rotation()
        const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
        this.speed = fwd.x * vel.x + fwd.y * vel.y + fwd.z * vel.z
        const cap = this.boosting ? t.boostMaxSpeed : t.maxSpeed
        this.speed01 = THREE.MathUtils.clamp(Math.abs(this.speed) / t.maxSpeed, 0, 1.35)

        if (!this.controlEnabled) return // tumbling in a crash — raw ragdoll

        const { throttle, steer, handbrake } = this.input

        // Steering: tight at low speed, calmer at speed; eased for feel
        const lock = t.steerMax / (1 + Math.abs(this.speed) * t.steerFalloff)
        const target = steer * lock
        this.steerVisual += (target - this.steerVisual) * Math.min(1, t.steerLerp * dt)
        this.controller.setWheelSteering(0, this.steerVisual)
        this.controller.setWheelSteering(1, this.steerVisual)

        // Engine on the rears; brake/reverse on S
        let engine = 0, brake = 0
        if (throttle > 0) engine = this.speed < cap ? t.enginePower : 0
        else if (throttle < 0) {
            if (this.speed > 1) brake = t.brakeForce
            else engine = -t.enginePower * 0.5
        }
        // Rear-dominant AWD: the fronts pull too (arcade punch out of corners),
        // but the rears drive harder so handbrake slides still rotate the car.
        this.controller.setWheelEngineForce(0, engine * 0.45)
        this.controller.setWheelEngineForce(1, engine * 0.45)
        this.controller.setWheelEngineForce(2, engine)
        this.controller.setWheelEngineForce(3, engine)
        this.controller.setWheelBrake(0, brake * 0.6)
        this.controller.setWheelBrake(1, brake * 0.6)
        this.controller.setWheelBrake(2, brake)
        this.controller.setWheelBrake(3, brake)

        // Grip is pushed every substep (not just at load) so GUI tweaks apply
        // live. Handbrake drops the REAR grip only → the tail steps out.
        this.controller.setWheelFrictionSlip(0, t.grip)
        this.controller.setWheelFrictionSlip(1, t.grip)
        this.controller.setWheelSideFrictionStiffness(0, t.sideGrip)
        this.controller.setWheelSideFrictionStiffness(1, t.sideGrip)
        const rearGrip = handbrake ? t.driftGripRear : t.grip
        const rearSide = handbrake ? t.driftSideRear : t.sideGrip
        this.controller.setWheelFrictionSlip(2, rearGrip)
        this.controller.setWheelFrictionSlip(3, rearGrip)
        this.controller.setWheelSideFrictionStiffness(2, rearSide)
        this.controller.setWheelSideFrictionStiffness(3, rearSide)
        if (handbrake) {
            this.controller.setWheelBrake(2, brake + 18)
            this.controller.setWheelBrake(3, brake + 18)
            if (Math.abs(this.speed) > 6) {
                this.body.applyTorqueImpulse({ x: 0, y: steer * t.driftYawKick * dt * Math.sign(this.speed), z: 0 }, true)
            }
        }

        // Boost: forward impulse + meter drain
        this.boosting = this.input.boost && this.boostMeter > 0 && Math.abs(this.speed) > 2
        if (this.boosting) {
            const imp = t.mass * t.boostAccel * dt
            this.body.applyImpulse({ x: fwd.x * imp, y: 0, z: fwd.z * imp }, true)
            this.boostMeter = Math.max(0, this.boostMeter - t.boostDrain * dt)
        } else {
            this.boostMeter = Math.min(100, this.boostMeter + t.boostRegen * dt)
        }

        // Soft top-speed cap
        const flat = Math.hypot(vel.x, vel.z)
        if (flat > cap) {
            const k = THREE.MathUtils.lerp(1, cap / flat, 0.12)
            this.body.setLinvel({ x: vel.x * k, y: vel.y, z: vel.z * k }, true)
        }

        this.controller.updateVehicle(dt)
    }

    /** Sync the Three.js visuals from the physics body (every render frame). */
    syncVisual(dt) {
        const p = this.body.translation()
        const r = this.body.rotation()
        this.group.position.set(p.x, p.y, p.z)
        this.group.quaternion.set(r.x, r.y, r.z, r.w)

        if (this.wheels.length) {
            this.wheelSpin += (-this.speed / this.wheelRadius) * dt // roll with travel (axle = local X)
            const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.wheelSpin)
            for (const w of this.wheels) {
                if (w.userData.front) {
                    const qSteer = new THREE.Quaternion().setFromAxisAngle(w.userData.steerAxis, this.steerVisual)
                    w.quaternion.copy(qSteer).multiply(w.userData.base).multiply(qSpin)
                } else {
                    w.quaternion.copy(w.userData.base).multiply(qSpin)
                }
            }
        }
    }

    forward() {
        const r = this.body.rotation()
        return new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    }

    position() {
        const p = this.body.translation()
        return new THREE.Vector3(p.x, p.y, p.z)
    }
}
