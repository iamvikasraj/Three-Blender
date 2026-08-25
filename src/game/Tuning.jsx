import { useEffect } from 'react'
import GUI from 'lil-gui'
import { TUNING, CAMERA } from './constants.js'
import { race } from './raceState.js'

/**
 * Live tuning panel — the same lil-gui folders as the vanilla build, so the
 * whole driving/camera feel can be dialled in while driving. Waits for the
 * vehicle to exist (so Suspension changes can call applySuspension), builds the
 * GUI once, and tears it down on unmount.
 */
export function Tuning() {
    useEffect(() => {
        let gui
        let raf
        const build = () => {
            const vehicle = race.vehicle
            if (!vehicle) { raf = requestAnimationFrame(build); return }

            gui = new GUI({ title: 'Tuning' })

            const fGrip = gui.addFolder('Grip & slide')
            fGrip.add(TUNING, 'sideGrip', 0.2, 6, 0.05).name('Lateral grip ← slide')
            fGrip.add(TUNING, 'grip', 1, 9, 0.1).name('Forward grip')
            fGrip.add(TUNING, 'driftGripRear', 0.1, 4, 0.05).name('Drift: rear grip')
            fGrip.add(TUNING, 'driftSideRear', 0.02, 1.5, 0.02).name('Drift: rear lateral')
            fGrip.add(TUNING, 'driftYawKick', 0, 1400, 20).name('Drift: yaw kick')

            const fSteer = gui.addFolder('Steering')
            fSteer.add(TUNING, 'steerMax', 0.2, 1.0, 0.01).name('Lock (rad)')
            fSteer.add(TUNING, 'steerFalloff', 0.005, 0.09, 0.001).name('Falloff w/ speed')
            fSteer.add(TUNING, 'steerLerp', 3, 30, 0.5).name('Response')

            const fPower = gui.addFolder('Power')
            fPower.add(TUNING, 'maxSpeed', 20, 110, 1).name('Top speed (m/s)')
            fPower.add(TUNING, 'boostMaxSpeed', 20, 130, 1).name('Boost top (m/s)')
            fPower.add(TUNING, 'enginePower', 4000, 30000, 250).name('Engine force')
            fPower.add(TUNING, 'brakeForce', 10, 120, 1).name('Brakes')
            fPower.add(TUNING, 'boostAccel', 4, 40, 0.5).name('Boost accel')

            const fSusp = gui.addFolder('Suspension')
            const reapply = () => vehicle.applySuspension()
            fSusp.add(TUNING.suspension, 'stiffness', 15, 110, 1).name('Stiffness').onChange(reapply)
            fSusp.add(TUNING.suspension, 'compression', 0.5, 6, 0.1).name('Compression').onChange(reapply)
            fSusp.add(TUNING.suspension, 'relaxation', 0.5, 8, 0.1).name('Relaxation').onChange(reapply)
            fSusp.add(TUNING.suspension, 'travel', 0.05, 0.6, 0.01).name('Travel').onChange(reapply)
            fSusp.close()

            const fCam = gui.addFolder('Camera')
            fCam.add(CAMERA, 'dist', 2, 14, 0.1).name('Distance')
            fCam.add(CAMERA, 'height', 0.4, 6, 0.05).name('Height')
            fCam.add(CAMERA, 'azimuth', -90, 90, 1).name('Azimuth (0=centre)')
            fCam.add(CAMERA, 'lookAhead', 2, 40, 0.5).name('Look ahead')
            fCam.add(CAMERA, 'lookHeight', 0, 4, 0.05).name('Look height')
            fCam.add(CAMERA, 'followLag', 0.00005, 0.02, 0.00005).name('Follow lag')

            const fFov = gui.addFolder('FOV & FX')
            fFov.add(CAMERA, 'fovBase', 35, 90, 1).name('FOV base')
            fFov.add(CAMERA, 'fovSpeed', 0, 40, 1).name('FOV @ speed')
            fFov.add(CAMERA, 'fovBoost', 0, 30, 1).name('FOV @ boost')
            fFov.add(CAMERA, 'shakeStart', 0.2, 1, 0.01).name('Shake starts')
            fFov.add(CAMERA, 'shakeAmp', 0, 0.3, 0.005).name('Shake amount')
            fFov.add(CAMERA, 'blurMax', 0, 0.2, 0.005).name('Motion blur')
            fFov.close()
        }
        build()
        return () => { cancelAnimationFrame(raf); gui?.destroy() }
    }, [])

    return null
}
