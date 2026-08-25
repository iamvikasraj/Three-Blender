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
        background: '#1a1c20',
        showFloor: true,
        showGrid: true,
        autoRotate: true,
    },
    camera: {
        type: 'orthographic', // 'perspective' or 'orthographic'
        fov: 45,             // perspective only
        zoom: 1,             // orthographic only (higher = closer)
        autoFrame: true,     // position the camera to frame the loaded model
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
    // Compute bounding box for scaling
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
 
    if (CONFIG.model.autoScale) {
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        object.scale.multiplyScalar(CONFIG.model.targetSize / maxDim)
    } else {
        object.scale.multiplyScalar(CONFIG.model.scale)
    }
 
    // Compute final bounding box once after scaling (reuse for all subsequent operations)
    const finalBox = new THREE.Box3().setFromObject(object)
    const finalSize = finalBox.getSize(new THREE.Vector3())
    const finalCenter = finalBox.getCenter(new THREE.Vector3())
 
    if (CONFIG.model.autoCenter) {
        object.position.x += object.position.x - finalCenter.x
        object.position.z += object.position.z - finalCenter.z
        object.position.y += (finalSize.y / 2) - finalCenter.y // rest bottom on the floor (y = 0)
    }
 
    // Frame the camera on the model
    if (CONFIG.camera.autoFrame) {
        const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z) || 1
        let dist
        if (camera.isOrthographicCamera) {
            // Size the ortho frustum to the model and fit with margin
            const margin = 1.25
            const aspect = sizes.width / sizes.height
            const halfH = (maxDim / 2) * margin
            camera.top = halfH
            camera.bottom = -halfH
            camera.left = -halfH * aspect
            camera.right = halfH * aspect
            camera.updateProjectionMatrix()
            dist = maxDim * 3 // any sufficiently far distance; ortho has no perspective falloff
        } else {
            dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))
        }
        // Low, cinematic three-quarter view — near eye level instead of top-down
        camera.position.set(finalCenter.x + dist * 0.9, finalCenter.y + finalSize.y * 0.15, finalCenter.z + dist * 1.1)
        controls.target.copy(finalCenter)
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
directionalLight.shadow.mapSize.set(1024, 1024)
directionalLight.shadow.camera.near = 0.5
directionalLight.shadow.camera.far = 30
directionalLight.shadow.camera.left = -10
directionalLight.shadow.camera.right = 10
directionalLight.shadow.camera.top = 10
directionalLight.shadow.camera.bottom = -10
directionalLight.shadow.normalBias = 0.05
scene.add(directionalLight)

// Rim light — cool-tinted back light for edge definition and drama
const rimLight = new THREE.DirectionalLight(0x88aaff, 1.5)
rimLight.position.set(-6, 4, -6)
scene.add(rimLight)

/**
 * Sizes
 */
const sizes = { width: window.innerWidth, height: window.innerHeight }

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    const aspect = sizes.width / sizes.height
    if (camera.isPerspectiveCamera) {
        camera.aspect = aspect
    } else if (camera.isOrthographicCamera) {
        const h = (camera.top - camera.bottom) / 2
        camera.left = -h * aspect
        camera.right = h * aspect
    }
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera + Controls
 */
const aspect = sizes.width / sizes.height
const camera = CONFIG.camera.type === 'orthographic'
    ? new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 200)
    : new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 200)
camera.zoom = CONFIG.camera.zoom ?? 1
camera.updateProjectionMatrix()
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
