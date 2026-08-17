import * as THREE from 'three'
import { world, RAPIER, time } from './physics.js'

/**
 * Crash director — time dilation, cinematic orbit hand-off, particles,
 * aftertouch, and respawn.
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  SLOWMO        physics time scale during a crash (0.22 = heavy slow-mo)
 *  DURATION      crash state length in REAL seconds
 *  AFTERTOUCH    torque impulse per second from steering while tumbling
 */
const SLOWMO = 0.22
const DURATION = 3.2
const AFTERTOUCH = 900

export class CrashDirector {
    constructor(scene, vehicle, chaseCam, banner) {
        this.scene = scene
        this.vehicle = vehicle
        this.cam = chaseCam
        this.banner = banner
        this.active = false
        this.timer = 0
        this.safe = { pos: new THREE.Vector3(-2.2, 1.2, 0), heading: 0 }
        this.safeTick = 0
        this.debris = []
        this.buildParticles()
    }

    buildParticles() {
        // Sparks
        this.sparkCount = 220
        this.sparkVel = []
        this.sparkLife = new Float32Array(this.sparkCount)
        const pos = new Float32Array(this.sparkCount * 3)
        this.sparkGeo = new THREE.BufferGeometry()
        this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        this.sparks = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({
            color: '#ffb545', size: 0.09, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }))
        this.sparks.visible = false
        this.sparks.frustumCulled = false
        this.scene.add(this.sparks)
        for (let i = 0; i < this.sparkCount; i++) this.sparkVel.push(new THREE.Vector3())

        // Smoke
        this.smokeCount = 40
        this.smokeVel = []
        this.smokeLife = new Float32Array(this.smokeCount)
        const spos = new Float32Array(this.smokeCount * 3)
        this.smokeGeo = new THREE.BufferGeometry()
        this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(spos, 3))
        this.smokeMat = new THREE.PointsMaterial({
            color: '#55505c', size: 1.6, transparent: true, opacity: 0.0, depthWrite: false,
        })
        this.smoke = new THREE.Points(this.smokeGeo, this.smokeMat)
        this.smoke.visible = false
        this.smoke.frustumCulled = false
        this.scene.add(this.smoke)
        for (let i = 0; i < this.smokeCount; i++) this.smokeVel.push(new THREE.Vector3())
    }

    /** Record a "safe" pose to respawn at (called while driving normally). */
    recordSafe(dt) {
        if (this.active) return
        this.safeTick += dt
        if (this.safeTick < 0.5) return
        this.safeTick = 0
        const v = this.vehicle
        if (Math.abs(v.speed) > 4) {
            const p = v.position()
            const f = v.forward()
            if (Math.abs(p.x) < 10.5) { // only if we're on the road
                this.safe.pos.set(p.x, p.y + 0.3, p.z)
                this.safe.heading = Math.atan2(f.x, f.z)
            }
        }
    }

    /** Enter the crash state: slow-mo + orbit cam + particles + free tumble. */
    trigger(impactPoint) {
        if (this.active) return
        this.active = true
        this.timer = 0
        time.scale = SLOWMO
        this.vehicle.controlEnabled = false
        this.cam.mode = 'crash'
        this.cam.orbitAngle = Math.random() * Math.PI * 2
        this.banner?.classList.add('is-visible')

        // Send the car tumbling
        const b = this.vehicle.body
        b.applyImpulse({ x: (Math.random() - 0.5) * 2600, y: 3400, z: -Math.sign(this.vehicle.speed || 1) * 1600 }, true)
        b.applyTorqueImpulse({
            x: (Math.random() - 0.5) * 2400,
            y: (Math.random() - 0.5) * 2400,
            z: (Math.random() - 0.5) * 3200,
        }, true)

        this.emitParticles(impactPoint ?? this.vehicle.position())
        this.spawnDebris(impactPoint ?? this.vehicle.position())
    }

    /** Light feedback for a wall scrape: sparks only, no crash state. */
    sparksAt(at) {
        this.sparks.visible = true
        const pos = this.sparkGeo.attributes.position.array
        for (let i = 0; i < this.sparkCount; i++) {
            pos[i * 3] = at.x; pos[i * 3 + 1] = at.y + 0.3; pos[i * 3 + 2] = at.z
            this.sparkVel[i].set(
                (Math.random() - 0.5) * 10,
                Math.random() * 6,
                (Math.random() - 0.5) * 10,
            )
            this.sparkLife[i] = 0.25 + Math.random() * 0.45
        }
        this.sparkGeo.attributes.position.needsUpdate = true
    }

    emitParticles(at) {
        this.sparks.visible = true
        const pos = this.sparkGeo.attributes.position.array
        for (let i = 0; i < this.sparkCount; i++) {
            pos[i * 3] = at.x; pos[i * 3 + 1] = at.y + 0.4; pos[i * 3 + 2] = at.z
            this.sparkVel[i].set(
                (Math.random() - 0.5) * 14,
                Math.random() * 9,
                (Math.random() - 0.5) * 14,
            )
            this.sparkLife[i] = 0.5 + Math.random() * 0.7
        }
        this.sparkGeo.attributes.position.needsUpdate = true

        this.smoke.visible = true
        this.smokeMat.opacity = 0.5
        const spos = this.smokeGeo.attributes.position.array
        for (let i = 0; i < this.smokeCount; i++) {
            spos[i * 3] = at.x + (Math.random() - 0.5) * 1.5
            spos[i * 3 + 1] = at.y + Math.random() * 1.2
            spos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 1.5
            this.smokeVel[i].set((Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6)
            this.smokeLife[i] = 1.5 + Math.random() * 1.8
        }
        this.smokeGeo.attributes.position.needsUpdate = true
    }

    spawnDebris(at) {
        for (let i = 0; i < 10; i++) {
            const size = 0.08 + Math.random() * 0.14
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(size, size, size),
                new THREE.MeshStandardMaterial({ color: i % 2 ? '#3a3f4a' : '#c8ccd4', roughness: 0.5, metalness: 0.7 }),
            )
            this.scene.add(mesh)
            const body = world.createRigidBody(
                RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + 0.6, at.z),
            )
            world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setMass(2).setRestitution(0.4), body)
            body.applyImpulse({
                x: (Math.random() - 0.5) * 16,
                y: Math.random() * 14,
                z: (Math.random() - 0.5) * 16,
            }, true)
            body.applyTorqueImpulse({ x: Math.random(), y: Math.random(), z: Math.random() }, true)
            this.debris.push({ mesh, body, born: performance.now() / 1000 })
        }
    }

    /** Aftertouch: nudge the tumbling wreck with the steering keys. */
    aftertouch(steer, pitch, dt) {
        if (!this.active) return
        const b = this.vehicle.body
        b.applyTorqueImpulse({ x: pitch * AFTERTOUCH * dt, y: steer * AFTERTOUCH * dt, z: 0 }, true)
    }

    update(dt) {
        // Particles tick (in real time, so slow-mo doesn't freeze them)
        if (this.sparks.visible) {
            const pos = this.sparkGeo.attributes.position.array
            let alive = false
            for (let i = 0; i < this.sparkCount; i++) {
                if ((this.sparkLife[i] -= dt) <= 0) continue
                alive = true
                this.sparkVel[i].y -= 22 * dt
                pos[i * 3] += this.sparkVel[i].x * dt
                pos[i * 3 + 1] += this.sparkVel[i].y * dt
                pos[i * 3 + 2] += this.sparkVel[i].z * dt
            }
            this.sparkGeo.attributes.position.needsUpdate = true
            if (!alive) this.sparks.visible = false
        }
        if (this.smoke.visible) {
            const spos = this.smokeGeo.attributes.position.array
            let alive = false
            for (let i = 0; i < this.smokeCount; i++) {
                if ((this.smokeLife[i] -= dt) <= 0) continue
                alive = true
                spos[i * 3] += this.smokeVel[i].x * dt
                spos[i * 3 + 1] += this.smokeVel[i].y * dt
                spos[i * 3 + 2] += this.smokeVel[i].z * dt
            }
            this.smokeGeo.attributes.position.needsUpdate = true
            this.smokeMat.opacity = Math.max(0, this.smokeMat.opacity - dt * 0.18)
            if (!alive) this.smoke.visible = false
        }

        // Debris cleanup
        const now = performance.now() / 1000
        this.debris = this.debris.filter((d) => {
            const p = d.body.translation()
            const r = d.body.rotation()
            d.mesh.position.set(p.x, p.y, p.z)
            d.mesh.quaternion.set(r.x, r.y, r.z, r.w)
            if (now - d.born > 5) {
                this.scene.remove(d.mesh)
                world.removeRigidBody(d.body)
                return false
            }
            return true
        })

        if (!this.active) return
        this.timer += dt
        if (this.timer >= DURATION) this.respawn()
    }

    respawn() {
        this.active = false
        time.scale = 1
        const b = this.vehicle.body
        b.setTranslation({ x: this.safe.pos.x, y: this.safe.pos.y, z: this.safe.pos.z }, true)
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.safe.heading)
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
        b.setLinvel({ x: 0, y: 0, z: 0 }, true)
        b.setAngvel({ x: 0, y: 0, z: 0 }, true)
        this.vehicle.controlEnabled = true
        this.vehicle.boostMeter = Math.max(this.vehicle.boostMeter, 40)
        this.cam.mode = 'chase'
        this.cam.snap = true
        this.banner?.classList.remove('is-visible')
    }
}
