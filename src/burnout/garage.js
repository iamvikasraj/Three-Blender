import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CARS } from './vehicle.js'

/**
 * Car select — a Burnout-style garage screen.
 *
 * Runs in its own scene so it can show immediately while the circuit streams in
 * behind it. Each car sits on a slow turntable under a warm key light with a
 * reflective floor; the HTML overlay carries the stat block and picker.
 *
 * ── KEY TUNABLES ────────────────────────────────────────────────────────────
 *  SPIN      turntable speed (rad/s)
 *  CAR_SIZE  longest dimension every car is normalised to (m)
 */
const SPIN = 0.35
const CAR_SIZE = 4.4

export class Garage {
    constructor(renderer) {
        this.renderer = renderer
        this.keys = Object.keys(CARS)
        this.index = 0
        this.models = new Map()
        this.selected = null
        this.turntable = new THREE.Group()

        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#16130f')
        this.scene.fog = new THREE.Fog('#16130f', 14, 46)

        this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
        this.camera.position.set(4.6, 2.0, 6.4)
        this.camera.lookAt(0, 0.7, 0)

        this.#buildRoom()
        this.scene.add(this.turntable)
    }

    #buildRoom() {
        // Glossy floor so the car gets a showroom reflection
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(26, 64),
            new THREE.MeshStandardMaterial({ color: '#2a2216', metalness: 0.5, roughness: 0.35 }),
        )
        floor.rotation.x = -Math.PI / 2
        floor.receiveShadow = true
        this.scene.add(floor)

        // Turntable disc the car stands on
        const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(3.4, 3.4, 0.08, 64),
            new THREE.MeshStandardMaterial({ color: '#3d3320', metalness: 0.6, roughness: 0.4 }),
        )
        disc.position.y = 0.04
        disc.receiveShadow = true
        this.scene.add(disc)

        // Warm industrial ambience + a hard key light for the hero look
        this.scene.add(new THREE.HemisphereLight('#ffd9a0', '#100c08', 0.5))
        this.scene.add(new THREE.AmbientLight('#ffe6c0', 0.35))

        const key = new THREE.SpotLight('#fff1d0', 90, 30, Math.PI * 0.3, 0.45, 1.4)
        key.position.set(4, 9, 5)
        key.castShadow = true
        key.shadow.mapSize.set(1024, 1024)
        key.shadow.bias = -0.0005
        this.scene.add(key, key.target)

        const rim = new THREE.SpotLight('#7fb4ff', 45, 26, Math.PI * 0.34, 0.5, 1.3)
        rim.position.set(-6, 5, -5)
        this.scene.add(rim, rim.target)

        const fill = new THREE.DirectionalLight('#ffab5c', 0.5)
        fill.position.set(-3, 2, 6)
        this.scene.add(fill)

        // Environment map so paint and chrome read properly
        const pmrem = new THREE.PMREMGenerator(this.renderer)
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        this.scene.environmentIntensity = 0.5
    }

    /** Load every car's visual model (no physics) and park them on the turntable. */
    async load() {
        const loader = new GLTFLoader()
        await Promise.all(this.keys.map(async (key) => {
            const car = CARS[key]
            const gltf = await new Promise((res, rej) => loader.load(car.path, res, undefined, rej))
            const model = gltf.scene
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
            model.scale.setScalar(CAR_SIZE / Math.max(size.x, size.y, size.z))
            model.rotation.y = car.modelYaw
            const box = new THREE.Box3().setFromObject(model)
            model.position.y = -box.min.y + 0.08 // sit on the disc
            model.traverse((c) => { if (c.isMesh) c.castShadow = true })
            model.visible = false
            this.models.set(key, model)
            this.turntable.add(model)
        }))
        this.#showCurrent()
    }

    #showCurrent() {
        this.keys.forEach((k) => { this.models.get(k).visible = k === this.current })
        this.turntable.rotation.y = 0
    }

    get current() { return this.keys[this.index] }
    get currentCar() { return CARS[this.current] }

    cycle(dir) {
        this.index = (this.index + dir + this.keys.length) % this.keys.length
        this.#showCurrent()
        return this.currentCar
    }

    select() {
        this.selected = this.current
        return this.selected
    }

    resize(w, h) {
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
    }

    update(dt) {
        this.turntable.rotation.y += SPIN * dt
    }

    render() {
        this.renderer.render(this.scene, this.camera)
    }

    dispose() {
        this.models.forEach((m) => m.traverse((c) => {
            if (c.isMesh) {
                c.geometry?.dispose()
                const mats = Array.isArray(c.material) ? c.material : [c.material]
                mats.forEach((mm) => mm?.dispose())
            }
        }))
        this.models.clear()
    }
}
