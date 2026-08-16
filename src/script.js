import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import GUI from 'lil-gui'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONFIG  ─  Edit this block to load your own model. Everything below adapts.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Export from Blender:  File → Export → glTF 2.0 (.glb/.gltf)
 *  Drop the file in:     static/models/<YourModel>/...
 *  Then just point `model.path` at it and reload. The model is auto-centered,
 *  scaled to a sensible size, placed on the floor, and its animations auto-play.
 */
const CONFIG = {
    model: {
        path: '/models/Fox/glTF/Fox.gltf', // ← change this to load any glTF/GLB
        autoScale: true,                    // fit the model to `targetSize`
        targetSize: 2,                      // desired height (world units) when autoScale is on
        scale: 1,                           // manual multiplier (used when autoScale is off)
        autoCenter: true,                   // center the model and rest it on the floor
    },
    animation: {
        autoPlay: true, // play a clip automatically if the model has any
        clip: 0,        // index OR name of the clip to play by default
    },
    scene: {
        background: '#2b2d31',
        showFloor: true,
        showGrid: true,
        autoRotate: false,
    },
    camera: {
        fov: 45,
        autoFrame: true, // position the camera to frame the loaded model
    },
}

/**
 * Base
 */
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(CONFIG.scene.background)

const gui = new GUI({ title: 'Model Controls' })

// Small helper to hide the HTML loading overlay once the model is ready
const loadingEl = document.querySelector('.loading')

/**
 * Loaders (glTF + Draco compression)
 * ── To add FBX/OBJ later: import the loader and branch on the file extension.
 */
const loadingManager = new THREE.LoadingManager(
    () => loadingEl && loadingEl.classList.add('is-hidden'), // onLoad
    (url, loaded, total) => { // onProgress
        if (loadingEl) loadingEl.textContent = `Loading… ${Math.round((loaded / total) * 100)}%`
    },
    (url) => console.error(`Failed to load: ${url}`), // onError
)

const dracoLoader = new DRACOLoader(loadingManager)
dracoLoader.setDecoderPath('/draco/')

const gltfLoader = new GLTFLoader(loadingManager)
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * Model handling
 */
let currentModel = null
let mixer = null
const actions = {} // name → THREE.AnimationAction

function clearCurrentModel() {
    if (!currentModel) return
    scene.remove(currentModel)
    currentModel.traverse((child) => {
        if (child.isMesh) {
            child.geometry?.dispose()
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            mats.forEach((m) => m?.dispose())
        }
    })
    currentModel = null
    mixer = null
    for (const k of Object.keys(actions)) delete actions[k]
}

function frameModel(object) {
    // Compute bounding box, then center / scale / seat on floor as configured.
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    if (CONFIG.model.autoScale) {
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        object.scale.multiplyScalar(CONFIG.model.targetSize / maxDim)
    } else {
        object.scale.multiplyScalar(CONFIG.model.scale)
    }

    if (CONFIG.model.autoCenter) {
        // Recompute after scaling
        const box2 = new THREE.Box3().setFromObject(object)
        const size2 = box2.getSize(new THREE.Vector3())
        const center2 = box2.getCenter(new THREE.Vector3())
        object.position.x += object.position.x - center2.x
        object.position.z += object.position.z - center2.z
        object.position.y += (size2.y / 2) - center2.y // rest bottom on the floor (y = 0)
    }

    // Frame the camera on the model
    if (CONFIG.camera.autoFrame) {
        const box3 = new THREE.Box3().setFromObject(object)
        const size3 = box3.getSize(new THREE.Vector3())
        const center3 = box3.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size3.x, size3.y, size3.z) || 1
        const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))
        camera.position.set(center3.x + dist, center3.y + dist * 0.6, center3.z + dist * 1.4)
        controls.target.copy(center3)
        controls.update()
    }
}

function setupAnimations(gltf) {
    if (!gltf.animations || gltf.animations.length === 0) return
    mixer = new THREE.AnimationMixer(gltf.scene)
    gltf.animations.forEach((clip) => {
        actions[clip.name] = mixer.clipAction(clip)
    })

    // Resolve which clip to auto-play (by index or by name)
    const names = gltf.animations.map((c) => c.name)
    let startName = names[0]
    if (typeof CONFIG.animation.clip === 'number') {
        startName = names[CONFIG.animation.clip] ?? names[0]
    } else if (names.includes(CONFIG.animation.clip)) {
        startName = CONFIG.animation.clip
    }

    if (CONFIG.animation.autoPlay) actions[startName]?.play()
    buildAnimationGui(names, startName)
}

function loadModel(path) {
    gltfLoader.load(
        path,
        (gltf) => {
            clearCurrentModel()
            currentModel = gltf.scene
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true
                    child.receiveShadow = true
                }
            })
            scene.add(currentModel)
            frameModel(currentModel)
            setupAnimations(gltf)
        },
        undefined,
        (err) => console.error('Error loading model:', err),
    )
}

/**
 * Environment: floor, grid, lights
 */
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: '#444444', metalness: 0, roughness: 0.6 }),
)
floor.rotation.x = -Math.PI * 0.5
floor.receiveShadow = true
floor.visible = CONFIG.scene.showFloor
scene.add(floor)

const grid = new THREE.GridHelper(20, 20, '#666666', '#3a3a3a')
grid.visible = CONFIG.scene.showGrid
scene.add(grid)

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2)
directionalLight.position.set(5, 8, 5)
directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(2048, 2048)
directionalLight.shadow.camera.near = 0.5
directionalLight.shadow.camera.far = 30
directionalLight.shadow.camera.left = -10
directionalLight.shadow.camera.right = 10
directionalLight.shadow.camera.top = 10
directionalLight.shadow.camera.bottom = -10
directionalLight.shadow.normalBias = 0.05
scene.add(directionalLight)

/**
 * Sizes
 */
const sizes = { width: window.innerWidth, height: window.innerHeight }

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera + Controls
 */
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, sizes.width / sizes.height, 0.1, 200)
camera.position.set(4, 3, 6)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.autoRotate = CONFIG.scene.autoRotate
controls.autoRotateSpeed = 1.5

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

/**
 * GUI
 */
let animationFolder = null

function buildAnimationGui(names, startName) {
    if (animationFolder) animationFolder.destroy()
    if (names.length === 0) return
    animationFolder = gui.addFolder('Animation')
    const state = { clip: startName }
    animationFolder
        .add(state, 'clip', names)
        .name('Play clip')
        .onChange((name) => {
            Object.values(actions).forEach((a) => a.fadeOut(0.2))
            actions[name]?.reset().fadeIn(0.2).play()
        })
}

const sceneFolder = gui.addFolder('Scene')
sceneFolder.add(floor, 'visible').name('Floor')
sceneFolder.add(grid, 'visible').name('Grid')
sceneFolder.add(controls, 'autoRotate').name('Auto-rotate')
sceneFolder.addColor(CONFIG.scene, 'background').name('Background').onChange((v) => {
    scene.background.set(v)
})

const lightFolder = gui.addFolder('Lighting')
lightFolder.add(ambientLight, 'intensity', 0, 5, 0.01).name('Ambient')
lightFolder.add(directionalLight, 'intensity', 0, 10, 0.01).name('Directional')

/**
 * Load the configured model + start the loop
 */
loadModel(CONFIG.model.path)

const clock = new THREE.Clock()
let previousTime = 0

const tick = () => {
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime

    if (mixer) mixer.update(deltaTime)
    controls.update()
    renderer.render(scene, camera)
    window.requestAnimationFrame(tick)
}

tick()
