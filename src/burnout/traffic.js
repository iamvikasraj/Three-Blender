import * as THREE from 'three'
import { world, RAPIER } from './physics.js'
import { ROAD } from './world.js'

/**
 * Traffic — a single stream of slow cars in one lane. The game is weaving
 * around them at speed; ramming one "checks" it (launches it like a projectile,
 * keeps your momentum, refills boost). No oncoming traffic for now — walls are
 * the only hard crash. Difficulty ramps by shrinking the gap between cars.
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  COUNT         cars alive at once
 *  GAP_EASY/HARD spawn gap (m) at difficulty 0 → 1 (main ramps difficulty
 *                with distance driven)
 *  CHECK_LAUNCH  multiplier on player speed applied to a checked car
 *  KEEP_SPEED    how much player momentum survives a check (0.96 ≈ barely slows)
 */
const COUNT = 10
const GAP_EASY = 120
const GAP_HARD = 55
const CHECK_LAUNCH = 1.5
const KEEP_SPEED = 0.96

const COLORS = ['#7a8fa8', '#a8977a', '#5f7a68', '#8a6a7a', '#6a7a8a', '#9a8a5a']

export class Traffic {
    constructor() {
        this.cars = []
        this.byCollider = new Map()
    }

    build(scene) {
        const lane = ROAD.lanes[0]
        for (let i = 0; i < COUNT; i++) {
            // All ahead of the spawn, spaced generously (easy start)
            const z = 60 + i * GAP_EASY * 0.8 + Math.random() * 25

            const mesh = new THREE.Group()
            const bodyBox = new THREE.Mesh(
                new THREE.BoxGeometry(1.8, 1.05, 4.2),
                new THREE.MeshStandardMaterial({ color: COLORS[i % COLORS.length], roughness: 0.6, metalness: 0.3 }),
            )
            bodyBox.position.y = 0.52
            bodyBox.castShadow = true
            const cabin = new THREE.Mesh(
                new THREE.BoxGeometry(1.6, 0.55, 2.0),
                new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.3 }),
            )
            cabin.position.set(0, 1.25, -0.2)
            mesh.add(bodyBox, cabin)
            scene.add(mesh)

            const body = world.createRigidBody(
                RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(lane.x, 0.8, z)
                    .setCanSleep(false)
                    .lockRotations(),
            )
            const collider = world.createCollider(
                RAPIER.ColliderDesc.cuboid(0.9, 0.75, 2.1).setMass(320).setFriction(0.5),
                body,
            )

            const car = { mesh, body, collider, lane, checked: false, checkedAt: 0 }
            this.cars.push(car)
            this.byCollider.set(collider.handle, car)
        }
    }

    /** Drive the stream; recycle passed/lost cars ahead. difficulty01: 0 easy → 1 hard. */
    update(now, playerZ, difficulty01 = 0) {
        for (const car of this.cars) {
            if (car.checked) {
                if (now - car.checkedAt > 6) this.respawn(car, playerZ, difficulty01)
            } else {
                const v = car.body.linvel()
                car.body.setLinvel({ x: 0, y: v.y, z: car.lane.dir * car.lane.speed }, true)
                const p = car.body.translation()
                // Recycle once overtaken (or lost far ahead after a wrap)
                if (p.z - playerZ < -50 || p.z - playerZ > 500) this.respawn(car, playerZ, difficulty01)
            }
            const p = car.body.translation()
            const r = car.body.rotation()
            car.mesh.position.set(p.x, p.y - 0.75, p.z)
            car.mesh.quaternion.set(r.x, r.y, r.z, r.w)
        }
    }

    respawn(car, playerZ, difficulty01 = 0) {
        const lane = ROAD.lanes[0]
        car.lane = lane
        car.checked = false
        car.body.lockRotations(true, true)
        car.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        // Ahead of the player; the gap tightens as difficulty ramps
        const gap = THREE.MathUtils.lerp(GAP_EASY, GAP_HARD, difficulty01)
        const z = playerZ + 170 + Math.random() * gap * 2
        const x = lane.x + (Math.random() - 0.5) * 1.2 // slight in-lane wobble
        car.body.setTranslation({ x, y: 0.8, z }, true)
    }

    /** Player rammed one: CHECK it — launch it, keep the player's momentum. */
    handleHit(car, vehicle) {
        if (car.checked) return null
        car.checked = true
        car.checkedAt = performance.now() / 1000
        car.body.lockRotations(false, true)
        const fwd = vehicle.forward()
        const v = vehicle.speed * CHECK_LAUNCH
        car.body.applyImpulse({
            x: (Math.random() - 0.5) * 640,
            y: 320 * 6,
            z: fwd.z * 320 * Math.max(8, v),
        }, true)
        car.body.applyTorqueImpulse({
            x: (Math.random() - 0.5) * 400,
            y: (Math.random() - 0.5) * 400,
            z: (Math.random() - 0.5) * 400,
        }, true)
        // The Burnout rule: checking never stops you
        const pv = vehicle.body.linvel()
        vehicle.body.setLinvel({ x: pv.x * KEEP_SPEED, y: pv.y, z: pv.z * KEEP_SPEED }, true)
        return 'checked'
    }
}
