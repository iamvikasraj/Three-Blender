import { useMemo } from 'react'
import { EffectComposer, ToneMapping, Pixelation, Bloom } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { RetroEffect } from './RetroEffect.js'
import { FilmEffect } from './FilmEffect.js'

/**
 * PS1 post chain: bloom the bright horizon/sun/tail-lights, tone-map to LDR,
 * crunch colour (band + dither), then pixelate the whole frame into chunky
 * blocks. Order matters — bloom runs first on the HDR-ish scene, pixelation last
 * so it blocks the already-crunched image (glow included).
 */
export function Retro() {
    const retro = useMemo(() => new RetroEffect({ levels: 16 }), [])
    const film = useMemo(() => new FilmEffect({ grainStrength: 0.012, vignetteStrength: 0.12 }), [])
    return (
        <EffectComposer>
            <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.62} luminanceSmoothing={0.28} radius={0.7} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <primitive object={retro} />
            <Pixelation granularity={5} />
            <primitive object={film} />
        </EffectComposer>
    )
}
