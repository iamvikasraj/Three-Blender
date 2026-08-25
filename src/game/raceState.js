/**
 * Cross-cutting handles for the active race, wired up by the scene components as
 * they mount and read by the single RaceLoop orchestrator. This is the R3F
 * equivalent of the module-level globals in the old `main.js` — kept mutable and
 * outside React so the 60 fps loop never touches component state.
 */
export const race = {
    vehicle: null,       // VehicleController
    chase: null,         // ChaseCamera
    speedLines: null,    // SpeedLines
    crash: null,         // CrashDirector
    setBlur: null,       // (strength:number) => void — radial-blur uniform setter
    traffic: null,       // Traffic | null (highway only)
    spawn: null,         // { x, y, z, heading } | null
    totalDist: 0,        // metres driven (ramps difficulty)
}

export function resetRace() {
    race.vehicle = null
    race.chase = null
    race.speedLines = null
    race.crash = null
    race.setBlur = null
    race.traffic = null
    race.totalDist = 0
}

/** Physics time dilation. scale < 1 = crash slow-mo (see PhysicsWorld). */
export const timeState = { scale: 1 }
