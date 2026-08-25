import { useMemo } from 'react'
import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { RetroEffect } from './RetroEffect.js'
import { FilmEffect } from './FilmEffect.js'

/**
 * Retro post chain: tone-map to LDR and gently crunch colour (band + dither),
 * with a light film grain/vignette. No pixelation — full-resolution render.
 */
export function Retro() {
    const retro = useMemo(() => new RetroEffect({ levels: 16 }), [])
    const film = useMemo(() => new FilmEffect({ grainStrength: 0.012, vignetteStrength: 0.12 }), [])
    return (
        <EffectComposer>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <primitive object={retro} />
            <primitive object={film} />
        </EffectComposer>
    )
}
