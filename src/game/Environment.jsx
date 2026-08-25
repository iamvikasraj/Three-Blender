import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { musicState, getMusicEnergy, getMusicSpectrum } from '../sunset/audio.js'

const EQ_BARS = 48 // vertical spectrum bars cut across the horizon

/**
 * Sky + lighting. Three presets, ported from world.js:
 *   'daylight' — bright overcast, matches the circuit's daylight-baked textures.
 *   'sunset'   — teal dusk for the procedural highway.
 *   'synthwave' — purple-orange arcade horizon with a glowing grid.
 */
export function Environment({ preset = 'daylight' }) {
     if (preset === 'daylight') return <Daylight />
     if (preset === 'synthwave') return <Synthwave />
     return <Sunset />
}

function Daylight() {
    return (
        <>
            <color attach="background" args={['#e8ecef']} />
            <fog attach="fog" args={['#dfe4e8', 400, 2600]} />
            <hemisphereLight args={['#eaf2ff', '#b0a89c', 1.5]} />
            <ambientLight args={['#ffffff', 0.35]} />
            <directionalLight
                color="#fff4e2"
                intensity={1.5}
                position={[-260, 420, 180]}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-near={1}
                shadow-camera-far={1000}
                shadow-camera-left={-150}
                shadow-camera-right={150}
                shadow-camera-top={150}
                shadow-camera-bottom={-150}
                shadow-bias={-0.0006}
            />
        </>
    )
}

function Sunset() {
    const skyMat = useMemo(() => new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color('#14867a') },     // deep teal zenith
            uMid: { value: new THREE.Color('#4fb89e') },     // teal-green
            uHorizon: { value: new THREE.Color('#dcecc6') }, // pale mint at the horizon
        },
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vDir; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
            void main() {
                float h = max(vDir.y, 0.0);
                vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
                c = mix(c, uTop, smoothstep(0.18, 0.75, h));
                gl_FragColor = vec4(c, 1.0);
            }
        `,
    }), [])

    return (
        <>
            <fog attach="fog" args={['#bfe0c2', 70, 480]} />
            <mesh material={skyMat} position={[0, 280, 820]}>
                <planeGeometry args={[2200, 700]} />
            </mesh>
            <mesh position={[0, 95, 1500]} onUpdate={(m) => m.lookAt(0, 40, 0)}>
                <circleGeometry args={[150, 64]} />
                <meshBasicMaterial color="#eef6e6" fog={false} />
            </mesh>
            <mesh position={[0, 95, 1510]} onUpdate={(m) => m.lookAt(0, 40, 0)}>
                <circleGeometry args={[230, 64]} />
                <meshBasicMaterial color="#a9e0bd" fog={false} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <hemisphereLight args={['#a8e0c0', '#1e3a2b', 0.9]} />
            <directionalLight
                color="#eaf6d8"
                intensity={1.6}
                position={[30, 30, 140]}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-camera-near={1}
                shadow-camera-far={160}
                shadow-camera-left={-30}
                shadow-camera-right={30}
                shadow-camera-top={30}
                shadow-camera-bottom={-30}
                shadow-bias={-0.0004}
            />
        </>
    )
}

function Synthwave() {
    // Spectrum → a 1-D data texture the sky shader samples across the horizon.
    const specData = useMemo(() => new Uint8Array(EQ_BARS), [])
    const specTex = useMemo(() => {
        const t = new THREE.DataTexture(specData, EQ_BARS, 1, THREE.RedFormat)
        t.magFilter = THREE.NearestFilter
        t.minFilter = THREE.NearestFilter
        t.needsUpdate = true
        return t
    }, [specData])
    const levels = useRef(new Float32Array(EQ_BARS)) // smoothed bar levels
    const rawSpec = useRef(new Float32Array(EQ_BARS)) // raw per-frame spectrum

    const skyMat = useMemo(() => new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color('#0c1f66') },     // deep dusk blue
            uMid: { value: new THREE.Color('#b8477c') },     // muted rose-magenta seam
            uHorizon: { value: new THREE.Color('#ff6a1e') }, // blazing orange
            uProgress: { value: 0 },
            uPulse: { value: 0 },
            uSpectrum: { value: specTex },
            uShowEq: { value: 0 }, // 0 = hidden, 1 = show the vertical bars
        },
        vertexShader: /* glsl */`
            varying vec3 vDir; varying vec4 vClip;
            void main() {
                vDir = normalize(position);
                vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = vClip;
            }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vDir; varying vec4 vClip; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
            uniform float uProgress; uniform float uPulse; uniform sampler2D uSpectrum; uniform float uShowEq;
            void main() {
                float h = max(vDir.y, 0.0);

                // ── Layer 1 — FIXED horizon: a full-blown sunset ramp, driven by
                // SCREEN-space height so the bands stay dead-flat (no spherical bowing).
                // sy: 0 bottom → 1 top; the horizon sits ~0.52 up the screen.
                float sy = clamp(vClip.y / vClip.w * 0.5 + 0.5, 0.0, 1.0);
                float t = clamp((sy - 0.50) / 0.50, 0.0, 1.0);
                vec3 sun = vec3(1.00, 0.80, 0.38);
                vec3 c = mix(sun, uHorizon, smoothstep(0.0, 0.06, t));
                c = mix(c, uMid, smoothstep(0.05, 0.15, t));
                c = mix(c, uTop, smoothstep(0.13, 0.48, t));
                float baseGlow = exp(-abs(vDir.y) * 62.0);
                c += vec3(1.0, 0.34, 0.08) * baseGlow * (0.35 + uPulse * 0.25) * (1.0 - uProgress);

                // ── Layer 2 — MOVING equalizer: vertical bars spread across the front
                // horizon, each rising to its own spectrum band. They're lit in the
                // SAME sunset gradient — just brighter — so they read as glowing
                // columns of the same colours, not a separate overlay.
                float az = atan(vDir.x, vDir.z);          // 0 straight ahead at the sun
                float u = az / 2.0 + 0.5;                  // spread bars across the front
                if (uShowEq > 0.5 && u > 0.0 && u < 1.0 && vDir.z > 0.0) {
                    float level = texture2D(uSpectrum, vec2(u, 0.5)).r;
                    float barH = 0.02 + level * 0.34;      // column height from the horizon
                    float slot = fract(u * float(${EQ_BARS})); // position within this bar
                    float col = smoothstep(0.12, 0.20, slot) * (1.0 - smoothstep(0.80, 0.88, slot));
                    float below = 1.0 - smoothstep(barH - 0.015, barH, h); // filled up to barH
                    float bar = col * below * step(0.0, vDir.y);
                    c += c * bar * 0.85;                   // brighten the same gradient into a lit column
                }

                // Nightfall as the song ends.
                vec3 nightHorizon = vec3(0.055, 0.035, 0.14);
                vec3 nightZenith = vec3(0.002, 0.006, 0.025);
                vec3 night = mix(nightHorizon, nightZenith, smoothstep(0.0, 0.8, h));
                c = mix(c, night, smoothstep(0.35, 1.0, uProgress));
                gl_FragColor = vec4(c, 1.0);
            }
        `,
    }), [specTex])

    const pulse = useRef(0)
    useFrame(() => {
        // Feed the bar heights into the texture, fast attack / slow release.
        const raw = getMusicSpectrum(EQ_BARS, rawSpec.current)
        rawSpec.current = raw
        const L = levels.current
        for (let i = 0; i < EQ_BARS; i++) {
            L[i] += (raw[i] - L[i]) * (raw[i] > L[i] ? 0.5 : 0.12)
            specData[i] = Math.min(255, L[i] * 255)
        }
        specTex.needsUpdate = true
        // Overall energy still gently breathes the fixed horizon glow.
        const e = Math.min(1, getMusicEnergy() * 3.2)
        pulse.current += (e - pulse.current) * (e > pulse.current ? 0.4 : 0.07)
        skyMat.uniforms.uProgress.value = musicState.progress
        skyMat.uniforms.uPulse.value = pulse.current
    })

    return (
        <>
            <color attach="background" args={['#0c1f66']} />
            <fog attach="fog" args={['#6b2c50', 120, 900]} />
            <mesh material={skyMat}>
                <sphereGeometry args={[1600, 32, 16]} />
            </mesh>
            <gridHelper args={[1800, 90, '#1c4ea0', '#13265f']} position={[0, -0.08, 700]} />
            <hemisphereLight args={['#9a7bd6', '#24154f', 1.35]} />
            <ambientLight color="#7458b8" intensity={0.55} />
            <directionalLight color="#ffb067" intensity={2.4} position={[40, 110, 180]} />
        </>
    )
}
