import { Suspense, useCallback, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'

import { PhysicsWorld } from './PhysicsWorld.jsx'
import { Environment } from './Environment.jsx'
import { Circuit } from './Circuit.jsx'
import { Track } from './Track.jsx'
import { Vehicle } from './Vehicle.jsx'
import { Effects } from './Effects.jsx'
import { ChaseCamera, SpeedLines } from './cameraFX.js'
import { CrashDirector } from './CrashDirector.js'
import { dent } from './deform.js'
import { race, timeState } from './raceState.js'
import { telemetry } from './telemetry.js'
import { keys } from './input.js'
import { CAMERA, USE_CIRCUIT, USE_TRACK, SCRAPE_DELTA_V, SCRAPE_PENALTY } from './constants.js'

/**
 * The race scene. Physics, world, circuit and car are declared here; the single
 * RaceLoop below advances everything in the same fixed order the vanilla tick()
 * used, so the driving feel and FX timing are unchanged.
 */
export function RaceScene({ car }) {
    // undefined = circuit still loading, null = no road spawn found, {} = spawn
    const [spawn, setSpawn] = useState(undefined)
    const onSpawn = useCallback((sp) => { race.spawn = sp; setSpawn(sp ?? null) }, [])

    return (
        <PhysicsWorld>
            <Environment preset={USE_CIRCUIT ? 'daylight' : 'sunset'} />

            {USE_TRACK ? (
                <Track onSpawn={onSpawn} />
            ) : (
                <Suspense fallback={null}>
                    <Circuit onSpawn={onSpawn} />
                </Suspense>
            )}

            {spawn !== undefined && (
                <Suspense fallback={null}>
                    <Vehicle car={car} spawn={spawn} />
                </Suspense>
            )}

            <RaceLoop />
            <Effects />
        </PhysicsWorld>
    )
}

function RaceLoop() {
    const { camera, scene } = useThree()
    const { world, rapier, step } = useRapier()

    useFrame((_, delta) => {
        const v = race.vehicle
        if (!v) return

        // Lazily wire the camera/FX/crash systems once the car exists.
        if (!race.chase) {
            race.chase = new ChaseCamera(camera)
            race.speedLines = new SpeedLines(camera)
            race.crash = new CrashDirector({ scene, world, rapier, vehicle: v, chase: race.chase })
            if (race.spawn) {
                race.crash.safe.pos.set(race.spawn.x, race.spawn.y + 0.6, race.spawn.z)
                race.crash.safe.heading = race.spawn.heading
            }
        }
        const crash = race.crash
        const dt = Math.min(delta, 0.05)

        // Input → vehicle
        v.input.throttle = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0
        v.input.steer = (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0
        v.input.handbrake = !!keys.Space
        v.input.boost = !!keys.ShiftLeft || !!keys.ShiftRight
        if (keys.KeyR && !crash.active) crash.respawn()

        if (crash.active) {
            crash.aftertouch(
                (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0,
                (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0,
                dt,
            )
        }

        // Physics: paused world, stepped here with time dilation. The vehicle's
        // per-substep forces run inside via useBeforePhysicsStep.
        const prevSpeed = Math.abs(v.speed)
        step(dt * timeState.scale)

        // Wall scrape: hard hits bleed speed (+ sparks + dent) rather than
        // triggering the crash state — keeps the run flowing.
        if (!crash.active && v.controlEnabled) {
            const drop = prevSpeed - Math.abs(v.speed)
            if (drop > SCRAPE_DELTA_V && prevSpeed > 12) {
                const impact = v.position().add(v.forward().multiplyScalar(1.5))
                dent(v.model, impact, 0.6, 0.08)
                crash.sparksAt(impact)
                const vel = v.body.linvel()
                v.body.setLinvel({ x: vel.x * SCRAPE_PENALTY, y: vel.y, z: vel.z * SCRAPE_PENALTY }, true)
            }
        }

        // Systems — difficulty ramps over ~5 km (only matters with traffic)
        race.totalDist += Math.abs(v.speed) * dt
        v.syncWheels(dt)
        crash.recordSafe(dt)
        crash.update(dt)
        race.chase.update(dt, v, v.boosting)
        race.speedLines.update(dt, v.speed01, v.boosting)

        // Post FX strength follows speed + boost
        race.setBlur?.(
            Math.max(0, v.speed01 - 0.55) * CAMERA.blurMax * 1.6 + (v.boosting ? CAMERA.blurMax * 0.5 : 0),
        )

        // HUD telemetry
        telemetry.speedKmh = Math.round(Math.abs(v.speed) * 3.6)
        telemetry.boost01 = v.boostMeter / 100
        telemetry.boosting = v.boosting
        const p = v.position(), f = v.forward()
        telemetry.x = p.x; telemetry.z = p.z
        telemetry.heading = Math.atan2(f.x, f.z)
    })

    return null
}
