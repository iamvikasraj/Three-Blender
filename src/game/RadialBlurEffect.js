import { Effect } from 'postprocessing'
import { Uniform } from 'three'

/**
 * Radial motion blur — the same 8-tap zoom blur the vanilla build ran as a
 * ShaderPass, reimplemented as a postprocessing `Effect` so it composes with the
 * @react-three/postprocessing pipeline. Strength is driven per-frame from speed
 * + boost (see RaceLoop).
 */
const fragment = /* glsl */`
    uniform float uStrength;
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 dir = uv - 0.5;
        vec4 sum = vec4(0.0);
        float w = 0.0;
        for (int i = 0; i < 8; i++) {
            float t = float(i) / 8.0;
            float k = 1.0 - t * 0.6;
            sum += texture(inputBuffer, uv - dir * uStrength * t) * k;
            w += k;
        }
        outputColor = sum / w;
    }
`

export class RadialBlurEffect extends Effect {
    constructor() {
        super('RadialBlurEffect', fragment, {
            uniforms: new Map([['uStrength', new Uniform(0)]]),
        })
    }

    set strength(v) { this.uniforms.get('uStrength').value = v }
    get strength() { return this.uniforms.get('uStrength').value }
}
