import { useMemo } from 'react'
import { EffectComposer, ToneMapping, Pixelation } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { RetroEffect } from './RetroEffect.js'
import { FilmEffect } from './FilmEffect.js'

/**
 * PS1 post chain: tone-map to LDR, crunch colour (band + dither), then pixelate
 * the whole frame into chunky blocks. Order matters — pixelation runs last so it
 * blocks the already-crunched image.
 */
export function Retro() {
    const retro = useMemo(() => new RetroEffect({ levels: 16 }), [])
    const film = useMemo(() => new FilmEffect({ grainStrength: 0.012, vignetteStrength: 0.12 }), [])
    return (
        <EffectComposer>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <primitive object={retro} />
            <Pixelation granularity={5} />
            <primitive object={film} />
        </EffectComposer>
    )
}
