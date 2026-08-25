import { create } from 'zustand'

/**
 * Game-flow state (React-driving). Kept deliberately small: only values that
 * actually change which components are mounted or what the menu shows.
 *
 * Per-frame telemetry (speed, boost, crash banner) does NOT live here — that
 * goes through the mutable `telemetry` singleton so the HUD can update via the
 * DOM without re-rendering React 60×/s.
 */
export const useGame = create((set) => ({
    phase: 'garage',   // 'garage' | 'race'
    carKey: 'bmw',     // currently highlighted / selected car

    setCar: (carKey) => set({ carKey }),
    startRace: (carKey) => set({ phase: 'race', carKey }),
    toGarage: () => set({ phase: 'garage' }),
}))
