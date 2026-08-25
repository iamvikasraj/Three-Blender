import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragment = /* glsl */`
    uniform float time;
    uniform float grainStrength;
    uniform float vignetteStrength;

    float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 3.5) * 43758.5453);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 color = inputColor.rgb;
        float grain = (noise(gl_FragCoord.xy) - 0.5) * grainStrength;
        float distanceFromCenter = length(uv - 0.5) * 1.35;
        float vignette = smoothstep(0.42, 0.95, distanceFromCenter) * vignetteStrength;
        vec3 highlights = smoothstep(vec3(0.68), vec3(1.0), color);

        color += grain;
        color += highlights * vec3(0.035, 0.012, 0.004);
        color *= 1.0 - vignette;
        outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
    }
`

export class FilmEffect extends Effect {
    constructor({ grainStrength = 0.035, vignetteStrength = 0.18 } = {}) {
        super('FilmEffect', fragment, {
            uniforms: new Map([
                ['time', new Uniform(0)],
                ['grainStrength', new Uniform(grainStrength)],
                ['vignetteStrength', new Uniform(vignetteStrength)],
            ]),
        })
    }

    update(_renderer, _inputBuffer, deltaTime) {
        this.uniforms.get('time').value += deltaTime
    }
}
