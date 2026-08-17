import * as THREE from 'three'

/**
 * Mesh-deformation placeholder — CPU vertex crumpling.
 * On impact, vertices near the impact point are pushed toward the car's core
 * with a smooth falloff, so panels visibly dent. Each mesh accumulates dents
 * up to MAX_DENT so repeated crashes don't implode the model.
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  radius    dent size in metres
 *  strength  how deep a single impact pushes (m)
 *  MAX_DENT  cumulative cap per vertex (m)
 */
const MAX_DENT = 0.22

const _local = new THREE.Vector3()
const _v = new THREE.Vector3()
const _dir = new THREE.Vector3()

export function dent(root, worldPoint, radius = 0.6, strength = 0.12) {
    root.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return
        const geo = mesh.geometry
        const pos = geo.attributes.position

        // Impact point and "core" (origin of the car) in this mesh's local space
        _local.copy(worldPoint)
        mesh.worldToLocal(_local)
        _dir.set(0, 0.3, 0).sub(_local).normalize() // push direction: toward the core

        // Per-mesh accumulated dent budget
        if (mesh.userData.dented === undefined) mesh.userData.dented = 0
        if (mesh.userData.dented >= MAX_DENT) return

        const scale = mesh.getWorldScale(_v).x || 1
        const localRadius = radius / scale
        const localStrength = Math.min(strength / scale, (MAX_DENT - mesh.userData.dented) / scale)
        let touched = false

        for (let i = 0; i < pos.count; i++) {
            const dx = pos.getX(i) - _local.x
            const dy = pos.getY(i) - _local.y
            const dz = pos.getZ(i) - _local.z
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (d > localRadius) continue
            const falloff = 1 - d / localRadius // 1 at impact center → 0 at edge
            const push = localStrength * falloff * falloff
            pos.setXYZ(i,
                pos.getX(i) + _dir.x * push,
                pos.getY(i) + _dir.y * push,
                pos.getZ(i) + _dir.z * push,
            )
            touched = true
        }
        if (touched) {
            mesh.userData.dented += strength * 0.6
            pos.needsUpdate = true
            geo.computeVertexNormals()
        }
    })
}
