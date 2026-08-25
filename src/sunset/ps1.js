import * as THREE from 'three'

/**
 * PS1 / retro-3D material tweaks.
 *
 * - Vertex snapping: the PS1 had no sub-pixel vertex precision, so vertices
 *   jittered onto a coarse grid as things moved. We reproduce it by snapping
 *   clip-space xy to a grid in the vertex shader (lower `snap` = chunkier wobble).
 * - Nearest-filter textures with no mipmaps for that crunchy low-res look.
 */
const snapChunk = (snap) => /* glsl */`
    #include <project_vertex>
    {
        float _snap = ${snap.toFixed(1)};
        vec4 _p = gl_Position;
        _p.xyz /= _p.w;
        _p.xy = floor(_p.xy * _snap) / _snap;
        _p.xyz *= _p.w;
        gl_Position = _p;
    }
`

export function ps1Material(material, snap = 110) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', snapChunk(snap))
    }
    material.needsUpdate = true
    return material
}

function nearest(m) {
    if (m.map) {
        m.map.magFilter = THREE.NearestFilter
        m.map.minFilter = THREE.NearestFilter
        m.map.generateMipmaps = false
        m.map.needsUpdate = true
    }
}

export function ps1Model(root, snap = 110) {
    root.traverse((o) => {
        if (!o.isMesh) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => { ps1Material(m, snap); nearest(m) })
    })
    return root
}

// Hue rotation around the greyscale axis — leaves whites/greys/blacks alone and
// spins saturated colours, so the blue livery becomes red without touching the
// white pattern, glass or tyres.
const huePrelude = /* glsl */`
    uniform float uHue;
    vec3 hueRotate(vec3 c, float a) {
        const vec3 k = vec3(0.57735);
        float ca = cos(a);
        return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
`

/**
 * Like ps1Model, but also injects a shared hue uniform on every car material so
 * the whole car can be re-painted at runtime by mutating `hueUniform.value`.
 */
export function ps1CarModel(root, snap = 110, hueUniform) {
    root.traverse((o) => {
        if (!o.isMesh) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
            m.onBeforeCompile = (shader) => {
                shader.uniforms.uHue = hueUniform
                shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', snapChunk(snap))
                shader.fragmentShader = huePrelude + shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    '#include <map_fragment>\n    diffuseColor.rgb = hueRotate(diffuseColor.rgb, uHue);',
                )
            }
            m.needsUpdate = true
            nearest(m)
        })
    })
    return root
}
