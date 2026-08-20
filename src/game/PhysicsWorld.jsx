import { Physics } from '@react-three/rapier'
import { FIXED_DT, GRAVITY } from './constants.js'

/**
 * The physics world for the race.
 *
 * We run react-three-rapier PAUSED and drive `step()` ourselves from the
 * RaceLoop (see RaceScene), feeding it `delta × timeState.scale`. That single
 * choice buys back the two things the vanilla engine relied on and the default
 * r3-rapier loop can't express:
 *
 *   • crash slow-mo — scaling the delta we feed to step() genuinely slows the
 *     simulation without touching the render framerate, exactly like the old
 *     time-dilated accumulator in physics.js.
 *   • fixed-substep vehicle forces — with a fixed timeStep, step() runs the
 *     `useBeforePhysicsStep` callbacks once per 1/60 substep, which is where the
 *     vehicle controller applies engine/steer/grip.
 *
 * `interpolate={false}` because, paused, r3-rapier snaps bodies to their exact
 * pose (alpha = 1) — the vanilla build never interpolated either.
 */
export function PhysicsWorld({ children }) {
    return (
        <Physics
            paused
            timeStep={FIXED_DT}
            interpolate={false}
            gravity={GRAVITY}
        >
            {children}
        </Physics>
    )
}
