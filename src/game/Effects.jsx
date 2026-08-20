import { useEffect, useMemo } from 'react'
import { EffectComposer } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { ToneMapping } from '@react-three/postprocessing'
import { RadialBlurEffect } from './RadialBlurEffect.js'
import { race } from './raceState.js'

/**
 * Post pipeline: radial motion blur (speed-driven) then ACES tone mapping,
 * matching the old EffectComposer chain. Registers race.setBlur so the RaceLoop
 * can push blur strength each frame without going through React.
 */
export function Effects() {
    const blur = useMemo(() => new RadialBlurEffect(), [])

    useEffect(() => {
        race.setBlur = (s) => { blur.strength = s }
        return () => { if (race.setBlur) race.setBlur = null }
    }, [blur])

    return (
        <EffectComposer>
            <primitive object={blur} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
    )
}
