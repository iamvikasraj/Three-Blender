import { Suspense, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'

import { CARS } from './constants.js'
import { useGame } from './store.js'
import { useKeyboard } from './input.js'
import { GarageScene } from './GarageScene.jsx'
import { GarageOverlay } from './GarageOverlay.jsx'
import { RaceScene } from './RaceScene.jsx'
import { Hud } from './Hud.jsx'
import { Tuning } from './Tuning.jsx'

const CAR_KEYS = Object.keys(CARS)

/**
 * Top-level game shell. A tiny state machine — 'garage' → 'race' — swaps which
 * scene is mounted in the single <Canvas> and which HTML overlay is shown. All
 * the heavy lifting lives in the scenes; App just wires flow + input.
 */
export default function App() {
    const phase = useGame((s) => s.phase)
    const carKey = useGame((s) => s.carKey)
    const setCar = useGame((s) => s.setCar)
    const startRace = useGame((s) => s.startRace)

    const cycle = useCallback((dir) => {
        const i = CAR_KEYS.indexOf(useGame.getState().carKey)
        setCar(CAR_KEYS[(i + dir + CAR_KEYS.length) % CAR_KEYS.length])
    }, [setCar])

    // Car-select navigation (garage phase only)
    const onPress = useCallback((code) => {
        if (useGame.getState().phase !== 'garage') return
        if (code === 'KeyA' || code === 'ArrowLeft') cycle(-1)
        else if (code === 'KeyD' || code === 'ArrowRight') cycle(1)
        else if (code === 'Enter' || code === 'Space') startRace(useGame.getState().carKey)
    }, [cycle, startRace])
    useKeyboard(onPress)

    return (
        <>
            <Canvas
                shadows
                dpr={[1, 1.5]}
                gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
                camera={{ fov: 60, near: 0.1, far: 2600, position: [6, 3, 8] }}
            >
                <Suspense fallback={null}>
                    {phase === 'garage'
                        ? <GarageScene carKey={carKey} />
                        : <RaceScene car={CARS[carKey]} />}
                </Suspense>
            </Canvas>

            {phase === 'garage' && (
                <GarageOverlay
                    carKey={carKey}
                    keys={CAR_KEYS}
                    onCycle={cycle}
                    onSelect={() => startRace(useGame.getState().carKey)}
                />
            )}
            {phase === 'race' && <Hud />}
            {phase === 'race' && <Tuning />}

            <Loading />
        </>
    )
}

function Loading() {
    const { active, progress } = useProgress()
    if (!active) return null
    return <div className="loading">Loading… {Math.round(progress)}%</div>
}
