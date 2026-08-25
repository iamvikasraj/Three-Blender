/**
 * Per-frame telemetry bridge between the game loop (inside <Canvas>) and the
 * HUD (React DOM). The loop writes here every frame; the HUD reads here from its
 * own rAF loop and pushes values straight to the DOM. No React state, so the
 * 60 fps stream of numbers never re-renders the tree.
 */
export const telemetry = {
    speedKmh: 0,
    boost01: 1,     // 0..1 boost meter fill
    boosting: false,
    crashed: false,
    x: 0,           // world position (for the minimap)
    z: 0,
    heading: 0,     // radians, atan2(forward.x, forward.z)
}

/** Reset between runs. */
export function resetTelemetry() {
    telemetry.speedKmh = 0
    telemetry.boost01 = 1
    telemetry.boosting = false
    telemetry.crashed = false
    telemetry.x = 0
    telemetry.z = 0
    telemetry.heading = 0
}
