import * as THREE from 'three'

/**
 * The "Burnout feel": chase camera + dynamic FOV + micro-shake at top speed,
 * a cinematic orbit camera during crashes, particle speed lines, and a
 * radial motion-blur post pass whose strength follows speed.
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  FOV_BASE/FOV_SPEED/FOV_BOOST  60° rest → ~78° fast → ~90° boosting
 *  SHAKE_START/SHAKE_AMP         when micro-shake kicks in and how hard
 *  BLUR_MAX                      radial blur strength ceiling
 */
// A tighter, lower camera makes the car read BIG against the city and gives a
// stronger sense of contact with the road (a far camera + wide FOV was what made
// the car look small relative to the map).
export const FOV_BASE = 54
export const FOV_SPEED = 14
export const FOV_BOOST = 10
export const CHASE_AZIMUTH = 0   // 0 = dead-centre behind; 48 = rear-3/4 hero
export const CHASE_DIST = 4.4    // close on the tail
export const CHASE_HEIGHT = 1.3  // low — roughly roof height, hugs the road
export const SHAKE_START = 0.72
export const SHAKE_AMP = 0.06
export const BLUR_MAX = 0.05

export class ChaseCamera {
    constructor(camera) {
        this.camera = camera
        this.mode = 'chase'          // 'chase' | 'crash'
        this.orbitAngle = 0
        this.snap = true
        this.fovBlend = 0
    }

    update(dt, vehicle, boosting) {
        const cam = this.camera
        if (this.mode === 'crash') {
            // Slow cinematic orbit around the tumbling car
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
            cam.fov += (FOV_BASE - cam.fov) * Math.min(1, dt * 3)
            cam.updateProjectionMatrix()
            return
        }

        // Chase: centered directly behind the car so the road ahead reads
        // symmetrically (CHASE_AZIMUTH = 0). Raise it for a rear-3/4 hero look.
        const p = vehicle.position()
        const fwd = vehicle.forward()
        const az = THREE.MathUtils.degToRad(CHASE_AZIMUTH)
        const bx = -fwd.x, bz = -fwd.z // dead-rear direction
        const ox = bx * Math.cos(az) + bz * Math.sin(az)
        const oz = -bx * Math.sin(az) + bz * Math.cos(az)
        const desired = new THREE.Vector3(
            p.x + ox * CHASE_DIST,
            p.y + CHASE_HEIGHT,
            p.z + oz * CHASE_DIST,
        )
        if (this.snap) { cam.position.copy(desired); this.snap = false }
        else cam.position.lerp(desired, 1 - Math.pow(0.0008, dt))

        // Micro-shake at top speed
        const over = Math.max(0, vehicle.speed01 - SHAKE_START)
        if (over > 0) {
            const a = SHAKE_AMP * (over / (1 - SHAKE_START)) * (boosting ? 1.5 : 1)
            cam.position.x += (Math.random() - 0.5) * a
            cam.position.y += (Math.random() - 0.5) * a * 0.6
        }

        // Aim just over the roof and further down the road, so a low camera
        // still shows what's coming rather than staring at the rear wing.
        const look = new THREE.Vector3(p.x + fwd.x * 12, p.y + 1.25, p.z + fwd.z * 12)
        cam.lookAt(look)

        // Dynamic FOV: stretches with speed, lunges on boost
        this.fovBlend += ((boosting ? 1 : 0) - this.fovBlend) * Math.min(1, dt * 4)
        const fov = FOV_BASE + vehicle.speed01 * FOV_SPEED + this.fovBlend * FOV_BOOST
        cam.fov += (fov - cam.fov) * Math.min(1, dt * 6)
        cam.updateProjectionMatrix()
    }
}

/** Additive streaks flying past the camera — cheap, readable speed FX. */
export class SpeedLines {
    constructor(camera) {
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
        camera.add(this.lines) // camera-space
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
}

/** Radial motion-blur shader for EffectComposer (strength driven per-frame). */
export const RadialBlurShader = {
    uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uStrength;
        void main() {
            vec2 dir = vUv - 0.5;
            vec4 sum = vec4(0.0);
            float w = 0.0;
            for (int i = 0; i < 8; i++) {
                float t = float(i) / 8.0;
                float k = 1.0 - t * 0.6;
                sum += texture2D(tDiffuse, vUv - dir * uStrength * t) * k;
                w += k;
            }
            gl_FragColor = sum / w;
        }
    `,
}
