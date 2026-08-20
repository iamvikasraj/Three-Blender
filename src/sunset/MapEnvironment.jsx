import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Themeable sky/lighting for a map — a gradient sky dome, a big horizon sun with
 * an additive halo, fog, and hemi + directional lights. All colours come from
 * the map config so each map has its own mood.
 */
export function MapEnvironment({ map }) {
    const skyMat = useMemo(() => new THREE.ShaderMaterial({
        side: THREE.BackSide, fog: false, depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color(map.sky.top) },
            uMid: { value: new THREE.Color(map.sky.mid) },
            uHorizon: { value: new THREE.Color(map.sky.horizon) },
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
    }), [map])

    return (
        <>
            <fog attach="fog" args={[map.fog, map.fogNear, map.fogFar]} />
            <mesh material={skyMat}><sphereGeometry args={[1600, 32, 16]} /></mesh>

            <mesh position={[0, 95, 1500]} onUpdate={(m) => m.lookAt(0, 40, 0)}>
                <circleGeometry args={[150, 64]} />
                <meshBasicMaterial color={map.sun} fog={false} />
            </mesh>
            <mesh position={[0, 95, 1510]} onUpdate={(m) => m.lookAt(0, 40, 0)}>
                <circleGeometry args={[230, 64]} />
                <meshBasicMaterial color={map.halo} fog={false} transparent opacity={0.35}
                    blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>

            <hemisphereLight args={map.hemi} />
            <directionalLight
                color={map.dir} intensity={map.dirIntensity} position={[30, 30, 140]}
                castShadow shadow-mapSize={[1024, 1024]}
                shadow-camera-near={1} shadow-camera-far={160}
                shadow-camera-left={-30} shadow-camera-right={30}
                shadow-camera-top={30} shadow-camera-bottom={-30} shadow-bias={-0.0004}
            />
        </>
    )
}
