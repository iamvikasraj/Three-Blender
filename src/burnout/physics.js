import RAPIER from '@dimforge/rapier3d-compat'

/**
 * Physics core — Rapier world with a fixed timestep and TIME DILATION.
 * `timeScale` < 1 slows the whole simulation (crash slow-mo) without
 * changing the render framerate: we just feed the accumulator less time.
 */
export const FIXED_DT = 1 / 60

export let world = null
export let eventQueue = null
export const time = { scale: 1 } // 1 = realtime, 0.25 = crash slow-mo

let accumulator = 0

export async function initPhysics() {
    await RAPIER.init()
    world = new RAPIER.World({ x: 0, y: -13.5, z: 0 }) // slightly heavy gravity = arcade planted feel
    world.timestep = FIXED_DT
    eventQueue = new RAPIER.EventQueue(true)
    return RAPIER
}

/**
 * Advance the simulation. `beforeSubstep(FIXED_DT)` runs before every substep
 * (vehicle forces/steering are applied there so they act at the fixed rate).
 */
export function stepPhysics(dt, beforeSubstep) {
    accumulator += Math.min(dt, 0.05) * time.scale
    let substeps = 0
    while (accumulator >= FIXED_DT && substeps < 6) {
        beforeSubstep?.(FIXED_DT)
        world.step(eventQueue)
        accumulator -= FIXED_DT
        substeps++
    }
    return substeps
}

export { RAPIER }
