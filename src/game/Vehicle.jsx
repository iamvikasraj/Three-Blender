import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RigidBody, CuboidCollider, useRapier, useBeforePhysicsStep } from '@react-three/rapier'
import { HALF, TUNING, FIXED_DT } from './constants.js'
import { VehicleController } from './VehicleController.js'
import { race } from './raceState.js'

/**
 * Player car. The <RigidBody> owns the chassis (react-three-rapier keeps the
 * visual root glued to the body), while the raycast vehicle controller is built
 * imperatively on that same body — the one part of the sim r3-rapier has no
 * declarative binding for. Wheel spin/steer is applied to the model's wheel
 * nodes from the RaceLoop after each step.
 */
export function Vehicle({ car, spawn, onReady }) {
    const bodyRef = useRef(null)
    const ctrlRef = useRef(null)
    const { world } = useRapier()
    const { scene } = useGLTF(car.path)

    // Build & align the model once (scale to the rig, orient the nose to +Z,
    // seat it on the suspension, and index the wheel nodes) — a port of the old
    // Vehicle.load(). Processed while detached (identity world matrix) so the
    // wheel front/steer axes are captured in rig space.
    const { carRoot, wheels, wheelRadius } = useMemo(() => {
        const model = cloneSkeleton(scene)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const scale = (HALF.l * 2) / Math.max(size.x, size.y, size.z)
        model.scale.setScalar(scale)
        model.rotation.y = car.modelYaw
        const box2 = new THREE.Box3().setFromObject(model)
        model.position.y = -(HALF.h + TUNING.suspension.rest * 0.9) - box2.min.y
        model.traverse((c) => { if (c.isMesh) c.castShadow = true })

        const carRoot = new THREE.Group()
        carRoot.add(model)
        carRoot.updateWorldMatrix(true, true)

        const wheels = []
        model.traverse((o) => { if (car.wheelPattern.test(o.name)) wheels.push(o) })
        const centers = wheels.map((w) => carRoot.worldToLocal(
            new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3())))
        wheels.forEach((w, i) => {
            w.userData.base = w.quaternion.clone()
            w.userData.front = centers[i].z > 0 // rig forward is +Z
            w.userData.steerAxis = new THREE.Vector3(0, 1, 0)
                .applyQuaternion(w.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
                .normalize()
        })
        let wheelRadius = 0.34
        if (wheels.length) {
            const ws = new THREE.Box3().setFromObject(wheels[0]).getSize(new THREE.Vector3())
            wheelRadius = Math.max(ws.y, ws.z) / 2 || wheelRadius
        }
        console.log(`[CAR] ${car.name}: ${wheels.length} wheels, r=${wheelRadius.toFixed(2)}m`)
        return { carRoot, wheels, wheelRadius }
    }, [scene, car])

    // Build the controller once the body exists.
    useEffect(() => {
        const body = bodyRef.current
        if (!body) return
        const ctrl = new VehicleController({ world, body, car })
        ctrl.wheels = wheels
        ctrl.wheelRadius = wheelRadius
        ctrl.model = carRoot
        ctrlRef.current = ctrl
        race.vehicle = ctrl
        onReady?.(ctrl)
        return () => {
            if (race.vehicle === ctrl) race.vehicle = null
            try { world.removeVehicleController?.(ctrl.controller) } catch { /* older rapier */ }
            ctrlRef.current = null
        }
    }, [world, car, wheels, wheelRadius, onReady])

    // Vehicle forces run once per fixed substep, before Rapier integrates.
    useBeforePhysicsStep(() => { ctrlRef.current?.substep(FIXED_DT) })

    const pos = spawn ? [spawn.x, spawn.y + 1.6, spawn.z] : [-2.2, 1.4, 0]
    const rot = spawn ? [0, spawn.heading, 0] : [0, 0, 0]

    return (
        <RigidBody
            ref={bodyRef}
            type="dynamic"
            colliders={false}
            canSleep={false}
            ccd
            enabledRotations={[false, true, false]}
            position={pos}
            rotation={rot}
            friction={0.4}
        >
            <CuboidCollider args={[HALF.w, HALF.h, HALF.l]} mass={TUNING.mass} />
            <primitive object={carRoot} />
        </RigidBody>
    )
}
