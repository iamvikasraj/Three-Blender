import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Sky + lighting. Two presets, ported from world.js:
 *   'daylight' — bright overcast, matches the circuit's daylight-baked textures.
 *   'sunset'   — synthwave magenta dusk for the procedural highway.
 */
export function Environment({ preset = 'daylight' }) {
    return preset === 'daylight' ? <Daylight /> : <Sunset />
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
            <mesh material={skyMat}>
                <sphereGeometry args={[1600, 32, 16]} />
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
