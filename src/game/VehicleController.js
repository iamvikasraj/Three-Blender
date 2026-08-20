import * as THREE from 'three'
import { TUNING } from './constants.js'

/**
 * Arcade vehicle on Rapier's DynamicRayCastVehicleController.
 *
 * This is the same proven handling model as the vanilla build's Vehicle class —
 * only the plumbing changed. The chassis rigid body and its collider are now
 * owned by a <RigidBody> (react-three-rapier syncs the visual root for us), and
 * `substep()` runs from a `useBeforePhysicsStep` callback. Everything between —
 * steering falloff, rear-dominant AWD, handbrake drift, boost, soft speed cap —
 * is a straight port of vehicle.js so the feel is preserved bit for bit.
 *
 * See constants.js TUNING for the dials.
 */
export class VehicleController {
    constructor({ world, body, car }) {
        this.world = world
        this.body = body
        this.car = car

        this.wheels = []            // three.js wheel nodes (set by Vehicle.jsx)
        this.wheelSpin = 0
        this.wheelRadius = 0.34
        this.steerVisual = 0
        this.input = { throttle: 0, steer: 0, handbrake: false, boost: false }
        this.boostMeter = 100
        this.boosting = false
        this.controlEnabled = true
        this.speed = 0
        this.speed01 = 0

        // Per-car handling overrides (weight class, grip, top speed)
        Object.assign(TUNING, car.tuning ?? {})

        // Raycast vehicle controller: 4 wheels, front pair steers, rear pair drives
        this.controller = world.createVehicleController(body)
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
    }

    /** Re-push suspension settings (call after changing them in the GUI). */
    applySuspension() {
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
        const t = TUNING
        const vel = this.body.linvel()
        const rot = this.body.rotation()
        const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
        this.speed = fwd.x * vel.x + fwd.y * vel.y + fwd.z * vel.z
        const cap = this.boosting ? t.boostMaxSpeed : t.maxSpeed
        this.speed01 = THREE.MathUtils.clamp(Math.abs(this.speed) / t.maxSpeed, 0, 1.35)

        if (!this.controlEnabled) return // tumbling in a crash — raw ragdoll

        // Arcade safety: this track is flat with no jumps, so the car should
        // never leave the ground. A wall hit at speed can impart a big upward
        // impulse (the box can't pitch, so it launches straight up) — clamp any
        // residual climb so a scrape stays a scrape instead of a 7 m pop-up.
        if (vel.y > 4) this.body.setLinvel({ x: vel.x, y: 4, z: vel.z }, true)

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
        this.controller.setWheelEngineForce(0, engine * 0.45)
        this.controller.setWheelEngineForce(1, engine * 0.45)
        this.controller.setWheelEngineForce(2, engine)
        this.controller.setWheelEngineForce(3, engine)
        this.controller.setWheelBrake(0, brake * 0.6)
        this.controller.setWheelBrake(1, brake * 0.6)
        this.controller.setWheelBrake(2, brake)
        this.controller.setWheelBrake(3, brake)

        // Grip pushed every substep so GUI tweaks apply live. Handbrake drops the
        // REAR grip only → the tail steps out.
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

    /** Spin/steer the visual wheels (react-three-rapier already moved the body). */
    syncWheels(dt) {
        if (!this.wheels.length) return
        this.wheelSpin += (-this.speed / this.wheelRadius) * dt
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

    forward() {
        const r = this.body.rotation()
        return new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    }

    position() {
        const p = this.body.translation()
        return new THREE.Vector3(p.x, p.y, p.z)
    }
}
