import { Effect } from 'postprocessing'
import { Uniform } from 'three'

/**
 * Retro colour crunch: quantise to a few colour levels (PS1-ish 15-bit banding)
 * with a 4x4 ordered (Bayer) dither so the bands break up like old hardware.
 */
const fragment = /* glsl */`
    uniform float levels;

    float bayer4(vec2 p) {
        float m[16] = float[16](
            0.0, 8.0, 2.0, 10.0,
            12.0, 4.0, 14.0, 6.0,
            3.0, 11.0, 1.0, 9.0,
            15.0, 7.0, 13.0, 5.0
        );
        int x = int(mod(p.x, 4.0));
        int y = int(mod(p.y, 4.0));
        return m[y * 4 + x] / 16.0 - 0.5;
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float d = bayer4(gl_FragCoord.xy) / levels;
        vec3 c = inputColor.rgb + d;
        c = floor(c * levels + 0.5) / levels;
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
    }
`

export class RetroEffect extends Effect {
    constructor({ levels = 16 } = {}) {
        super('RetroEffect', fragment, { uniforms: new Map([['levels', new Uniform(levels)]]) })
    }
}
