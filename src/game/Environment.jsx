import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { musicState } from '../sunset/audio.js'

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
    const skyMat = useMemo(() => new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color('#08002f') },
            uMid: { value: new THREE.Color('#3b078f') },
            uHorizon: { value: new THREE.Color('#ff7514') },
            uProgress: { value: 0 },
        },
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vDir; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform float uProgress;
            void main() {
                float h = max(vDir.y, 0.0);
                vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
                c = mix(c, uTop, smoothstep(0.2, 0.8, h));
                float glow = exp(-abs(vDir.y) * 70.0);
                c += vec3(1.0, 0.16, 0.015) * glow * 0.22 * (1.0 - uProgress);
                vec3 nightHorizon = vec3(0.055, 0.035, 0.14);
                vec3 nightZenith = vec3(0.002, 0.006, 0.025);
                vec3 night = mix(nightHorizon, nightZenith, smoothstep(0.0, 0.8, h));
                c = mix(c, night, smoothstep(0.35, 1.0, uProgress));
                gl_FragColor = vec4(c, 1.0);
            }
        `,
    }), [])

    useFrame(() => { skyMat.uniforms.uProgress.value = musicState.progress })

    return (
        <>
            <color attach="background" args={['#08002f']} />
            <fog attach="fog" args={['#4a2c85', 120, 900]} />
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
