import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { CARS } from '../game/constants.js'
import { ps1CarModel } from './ps1.js'
import { net, onRoster } from './net.js'
import { session } from './session.js'

/**
 * Renders every OTHER player's car on our road. Both players share the same
 * endless road, so a rival at track-distance `dist` sits at world z equal to the
 * gap between us — you literally watch them pull ahead (+z) or drop back (−z).
 */
const CAR = CARS.bmw

export function Ghosts() {
    const [ids, setIds] = useState([])
    useEffect(() => {
        const update = () => setIds(Object.keys(net.players).filter((id) => id !== net.id))
        const off = onRoster(update)
        update()
        return off
    }, [])
    return ids.map((id) => <Ghost key={id} id={id} />)
}

function Ghost({ id }) {
    const { scene } = useGLTF(CAR.path)
    const groupRef = useRef(null)
    const hue = useMemo(() => ({ value: 0 }), [])
    const model = useMemo(() => {
        const m = cloneSkeleton(scene)
        const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
        m.scale.setScalar(4.4 / Math.max(size.x, size.y, size.z))
        m.rotation.y = CAR.modelYaw
        m.position.y = -new THREE.Box3().setFromObject(m).min.y
        const root = new THREE.Group(); root.add(m)
        ps1CarModel(root, 90, hue)
        return root
    }, [scene, hue])

    useFrame(() => {
        const p = net.players[id]
        const g = groupRef.current
        if (!g) return
        if (!p) { g.visible = false; return }
        g.visible = true
        hue.value = p.hue || 0
        g.position.set(p.x || 0, 0, (p.dist || 0) - session.distance)
    })

    return <group ref={groupRef}><primitive object={model} /></group>
}
