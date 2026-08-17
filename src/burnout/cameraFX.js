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
/**
 * Live camera config — every field is exposed in the GUI so the feel can be
 * dialled in while driving. A tighter, lower camera makes the car read BIG
 * against the city; a far camera behind a wide FOV made it look small.
 */
export const CAMERA = {
    azimuth: 0,      // 0 = dead-centre behind; 48 = rear-3/4 hero angle
    dist: 4.4,       // how far behind the car
    height: 1.3,     // roughly roof height — hugs the road
    lookAhead: 12,   // aim this far down the road (keeps a low cam useful)
    lookHeight: 1.25,
    fovBase: 54,     // FOV at rest
    fovSpeed: 14,    // extra FOV at top speed
    fovBoost: 10,    // extra FOV while boosting
    shakeStart: 0.72, // speed fraction where micro-shake begins
    shakeAmp: 0.06,
    blurMax: 0.05,   // radial motion-blur ceiling
    followLag: 0.0008, // lower = snappier follow
}

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
            cam.fov += (CAMERA.fovBase - cam.fov) * Math.min(1, dt * 3)
            cam.updateProjectionMatrix()
            return
        }

        // Chase: offset `azimuth` degrees off the car's tail (0 = dead-centre,
        // so the road ahead reads symmetrically).
        const p = vehicle.position()
        const fwd = vehicle.forward()
        const az = THREE.MathUtils.degToRad(CAMERA.azimuth)
        const bx = -fwd.x, bz = -fwd.z // dead-rear direction
        const ox = bx * Math.cos(az) + bz * Math.sin(az)
        const oz = -bx * Math.sin(az) + bz * Math.cos(az)
        const desired = new THREE.Vector3(
            p.x + ox * CAMERA.dist,
            p.y + CAMERA.height,
            p.z + oz * CAMERA.dist,
        )
        if (this.snap) { cam.position.copy(desired); this.snap = false }
        else cam.position.lerp(desired, 1 - Math.pow(CAMERA.followLag, dt))

        // Micro-shake at top speed
        const over = Math.max(0, vehicle.speed01 - CAMERA.shakeStart)
        if (over > 0) {
            const a = CAMERA.shakeAmp * (over / (1 - CAMERA.shakeStart)) * (boosting ? 1.5 : 1)
            cam.position.x += (Math.random() - 0.5) * a
            cam.position.y += (Math.random() - 0.5) * a * 0.6
        }

        // Aim down the road, so a low camera still shows what's coming rather
        // than staring at the rear wing.
        const look = new THREE.Vector3(
            p.x + fwd.x * CAMERA.lookAhead,
            p.y + CAMERA.lookHeight,
            p.z + fwd.z * CAMERA.lookAhead,
        )
        cam.lookAt(look)

        // Dynamic FOV: stretches with speed, lunges on boost
        this.fovBlend += ((boosting ? 1 : 0) - this.fovBlend) * Math.min(1, dt * 4)
        const fov = CAMERA.fovBase + vehicle.speed01 * CAMERA.fovSpeed + this.fovBlend * CAMERA.fovBoost
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
