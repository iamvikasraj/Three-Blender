import * as THREE from 'three'
import { CAMERA } from './constants.js'

/**
 * Chase camera + dynamic FOV + micro-shake, and a cinematic orbit during
 * crashes. Ported from cameraFX.js; reads the live CAMERA config every frame so
 * the tuning panel can dial the feel in while driving.
 */
export class ChaseCamera {
    constructor(camera) {
        this.camera = camera
        this.mode = 'chase'   // 'chase' | 'crash'
        this.orbitAngle = 0
        this.snap = true
        this.fovBlend = 0
    }

    update(dt, vehicle, boosting) {
        const cam = this.camera
        if (this.mode === 'crash') {
            this.orbitAngle += dt * 0.75
            const p = vehicle.position()
            const r = 7.5
            const target = new THREE.Vector3(
                p.x + r * Math.sin(this.orbitAngle),
                p.y + 2.4,
                p.z + r * Math.cos(this.orbitAngle),
            )
            cam.position.lerp(target, 1 - Math.pow(0.001, dt))
            cam.lookAt(p.x, p.y + 0.4, p.z)
            cam.fov += (CAMERA.fovBase - cam.fov) * Math.min(1, dt * 3)
            cam.updateProjectionMatrix()
            return
        }

        const p = vehicle.position()
        const fwd = vehicle.forward()
        const az = THREE.MathUtils.degToRad(CAMERA.azimuth)
        const bx = -fwd.x, bz = -fwd.z
        const ox = bx * Math.cos(az) + bz * Math.sin(az)
        const oz = -bx * Math.sin(az) + bz * Math.cos(az)
        const desired = new THREE.Vector3(
            p.x + ox * CAMERA.dist,
            p.y + CAMERA.height,
            p.z + oz * CAMERA.dist,
        )
        if (this.snap) { cam.position.copy(desired); this.snap = false }
        else cam.position.lerp(desired, 1 - Math.pow(CAMERA.followLag, dt))

        const over = Math.max(0, vehicle.speed01 - CAMERA.shakeStart)
        if (over > 0) {
            const a = CAMERA.shakeAmp * (over / (1 - CAMERA.shakeStart)) * (boosting ? 1.5 : 1)
            cam.position.x += (Math.random() - 0.5) * a
            cam.position.y += (Math.random() - 0.5) * a * 0.6
        }

        const look = new THREE.Vector3(
            p.x + fwd.x * CAMERA.lookAhead,
            p.y + CAMERA.lookHeight,
            p.z + fwd.z * CAMERA.lookAhead,
        )
        cam.lookAt(look)

        this.fovBlend += ((boosting ? 1 : 0) - this.fovBlend) * Math.min(1, dt * 4)
        const fov = CAMERA.fovBase + vehicle.speed01 * CAMERA.fovSpeed + this.fovBlend * CAMERA.fovBoost
        cam.fov += (fov - cam.fov) * Math.min(1, dt * 6)
        cam.updateProjectionMatrix()
    }
}

/** Additive streaks flying past the camera — cheap, readable speed FX. */
export class SpeedLines {
    constructor(camera) {
        this.camera = camera
        this.count = 90
        this.data = []
        const positions = new Float32Array(this.count * 2 * 3)
        for (let i = 0; i < this.count; i++) {
            this.data.push({
                x: (Math.random() - 0.5) * 18,
                y: (Math.random() - 0.5) * 10,
                z: -(10 + Math.random() * 60),
            })
        }
        this.geo = new THREE.BufferGeometry()
        this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        this.mat = new THREE.LineBasicMaterial({
            color: '#cfd6ff', transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        })
        this.lines = new THREE.LineSegments(this.geo, this.mat)
        this.lines.frustumCulled = false
        camera.add(this.lines)
    }

    update(dt, speed01, boosting) {
        const strength = THREE.MathUtils.clamp((speed01 - 0.55) * 2.2, 0, 1) + (boosting ? 0.35 : 0)
        this.mat.opacity += (THREE.MathUtils.clamp(strength * 0.5, 0, 0.6) - this.mat.opacity) * Math.min(1, dt * 5)
        const pos = this.geo.attributes.position.array
        const speed = 60 + speed01 * 160
        const len = 1.2 + speed01 * 5
        for (let i = 0; i < this.count; i++) {
            const d = this.data[i]
            d.z += speed * dt
            if (d.z > -4) {
                d.z = -(45 + Math.random() * 40)
                d.x = (Math.random() - 0.5) * 20
                d.y = (Math.random() - 0.5) * 12
            }
            const o = i * 6
            pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z
            pos[o + 3] = d.x; pos[o + 4] = d.y; pos[o + 5] = d.z - len
        }
        this.geo.attributes.position.needsUpdate = true
    }

    dispose() {
        this.camera.remove(this.lines)
        this.geo.dispose()
        this.mat.dispose()
    }
}
