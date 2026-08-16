import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import GUI from 'lil-gui'

// Accelerated raycasting for the big city geometry (ground-follow while driving)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

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
        path: '/models/bmw_m3_gtr_-_nfs_mw.glb', // ← change this to load any glTF/GLB
        autoScale: true,                    // fit the model to `targetSize`
        targetSize: 2,                      // desired height (world units) when autoScale is on
        scale: 1,                           // manual multiplier (used when autoScale is off)
        autoCenter: true,                   // center the model and rest it on the floor
    },
    animation: {
        autoPlay: true, // play a clip automatically if the model has any
        clip: 0,        // index OR name of the clip to play by default
    },
    // Optional static environment model (e.g. the NFS Rockport map).
    // Loaded at its own scale — the car sits inside it. Tune the transform
    // live in the GUI ("Environment (map)" folder) to slide a road under the car.
    environment: {
        enabled: true,
        // All Rockport map parts share ONE world coordinate system, so every part
        // gets the SAME transform below and they assemble into the full city.
        // Toggle parts on/off here (or live in the GUI) — the full set is ~3.3M
        // triangles / 452 MB, which is heavy; disable parts if it lags.
        // Optimized parts (gltf-transform: joined + simplified + webp). Each part
        // carries a bounding box (in map-local units) used by streaming to decide
        // which parts to keep loaded near the car.
        parts: [
            { path: '/models/maps/opt/nfs_most_wanted_2005_-_rockport_map_part_1.glb', enabled: true, box: { cx: 424, cz: -2697, rx: 1885, rz: 799 } },
            { path: '/models/maps/opt/nfs_most_wanted_-_rockport_map_part_2.glb', enabled: true, box: { cx: 400, cz: -2764, rx: 1866, rz: 733 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_3.glb', enabled: true, box: { cx: 2849, cz: -1733, rx: 4553, rz: 4665 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_5.glb', enabled: true, box: { cx: 2496, cz: -993, rx: 1241, rz: 1320 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_6.glb', enabled: true, box: { cx: 1148, cz: -1738, rx: 1719, rz: 2876 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_7.glb', enabled: true, box: { cx: 1875, cz: -3831, rx: 1597, rz: 1440 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_10.glb', enabled: true, box: { cx: 3219, cz: -2072, rx: 1936, rz: 2646 } },
            { path: '/models/maps/opt/nfs_most_wanted_rockport_map_part_11.glb', enabled: true, box: { cx: 3142, cz: -1441, rx: 1756, rz: 1807 } },
        ],
        // Anchored on the central "EastPark" street tile so the car lands on a
        // road at street level, sized so a lane ~ fits the car. (Derived by
        // analysing the map's TRN_*Road* meshes — see notes in the README.)
        scale: 0.17051,
        position: { x: -360.29, y: -15.78, z: 17.22 },
        rotationY: 0, // degrees
    },
    scene: {
        background: '#1a1410', // warm, dark "garage" backdrop
        showFloor: false,      // the map provides its own ground
        showGrid: false,
        autoRotate: false,     // fixed hero angle (set autoRotate:true for a turntable)
        autoRotateSpeed: 0.6,
    },
    camera: {
        fov: 40,
        autoFrame: true,       // position the camera to frame the loaded model
        heroAngle: true,       // low, dramatic 3/4-front angle like the game menu
        heroAzimuth: 48,       // degrees around the car (close rear-3/4, wheel in foreground)
        heroElevation: 5,      // degrees above the ground (low = dramatic)
        heroDistance: 0.95,    // multiplier on the auto-fit distance (smaller = tighter)
    },
    // Test track ─ hide the city and drive on a simple flat course to tune the
    // driving feel. Set enabled:false to go back to the Rockport map.
    testTrack: {
        enabled: true,
        size: 400,
    },
    // Arcade drive mode ─ WASD / arrows to drive the car around the map.
    // No collision yet; a downward raycast keeps the car on the road surface.
    drive: {
        enabled: false,
        maxSpeed: 9,        // world units / sec forward
        reverseMax: 4,
        accel: 14,          // how fast it speeds up
        friction: 4,        // coast-down when off the throttle
        steer: 1.9,         // turn rate (radians/sec at speed)
        groundFollow: true, // raycast down onto the map so it follows hills
        headingOffset: 0,   // degrees, auto-set at load to align the nose with travel
        camDistance: 6.5,   // chase camera distance from the car (world units)
        camElevation: 9,    // chase camera height angle (deg) — low & cinematic
        camAzimuth: 48,     // rear-3/4 offset (matches the hero menu angle)
    },
    // "Most Wanted" cinematic look ─ toggle any of these live in the GUI
    cinematic: {
        enabled: true,
        bloom: 0.22,           // glow strength on highlights
        bloomThreshold: 0.92,  // only the brightest pixels glow
        exposure: 0.95,
        envIntensity: 0.5,     // how much the environment lights/reflects the car
        warmth: 0.14,          // warm/orange color grade (0 = neutral)
        contrast: 1.12,
        saturation: 1.08,
        vignette: 1.05,        // darkened edges
    },
}

/**
 * Base
 */
// Cap render resolution — the full city + post-processing is fragment-bound, so
// clamping the pixel ratio is the biggest single perf win on high-DPI screens.
const MAX_PIXEL_RATIO = 1

const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(CONFIG.scene.background)
// Light fog for depth. Pushed far out when a big environment model is present,
// otherwise it would cull the whole map.
scene.fog = new THREE.Fog(
    CONFIG.scene.background,
    CONFIG.environment.enabled ? 60 : 8,
    CONFIG.environment.enabled ? 600 : 22,
)

const gui = new GUI({ title: 'Menu Controls' })

const loadingEl = document.querySelector('.loading')

/**
 * Loaders (glTF + Draco compression)
 */
const loadingManager = new THREE.LoadingManager(
    () => loadingEl && loadingEl.classList.add('is-hidden'),
    (url, loaded, total) => {
        if (loadingEl) loadingEl.textContent = `Loading… ${Math.round((loaded / total) * 100)}%`
    },
    (url) => console.error(`Failed to load: ${url}`),
)

const dracoLoader = new DRACOLoader(loadingManager)
dracoLoader.setDecoderPath('/draco/')

const gltfLoader = new GLTFLoader(loadingManager)
gltfLoader.setDRACOLoader(dracoLoader)
gltfLoader.setMeshoptDecoder(MeshoptDecoder) // optimized map parts use meshopt compression

/**
 * Model handling
 */
let currentModel = null
let mixer = null
const actions = {}
const carHome = { position: new THREE.Vector3(), rotationY: 0 } // spawn transform for drive mode
let carGroundOffset = 0 // distance from the car's pivot down to its wheels (so it rests ON roads)
const wheels = []       // wheel nodes, spun while driving
let wheelRadius = 0.34  // world units, derived from the model

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
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())

    if (CONFIG.model.autoScale) {
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        object.scale.multiplyScalar(CONFIG.model.targetSize / maxDim)
    } else {
        object.scale.multiplyScalar(CONFIG.model.scale)
    }

    if (CONFIG.model.autoCenter) {
        const box2 = new THREE.Box3().setFromObject(object)
        const size2 = box2.getSize(new THREE.Vector3())
        const center2 = box2.getCenter(new THREE.Vector3())
        object.position.x += object.position.x - center2.x
        object.position.z += object.position.z - center2.z
        object.position.y += (size2.y / 2) - center2.y // rest bottom on the floor (y = 0)
    }

    if (CONFIG.camera.autoFrame) {
        const box3 = new THREE.Box3().setFromObject(object)
        const size3 = box3.getSize(new THREE.Vector3())
        const center3 = box3.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size3.x, size3.y, size3.z) || 1
        const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))

        if (CONFIG.camera.heroAngle) {
            // Low, dramatic 3/4-front angle like the garage menu, via spherical coords
            const az = THREE.MathUtils.degToRad(CONFIG.camera.heroAzimuth)
            const el = THREE.MathUtils.degToRad(CONFIG.camera.heroElevation)
            const r = dist * CONFIG.camera.heroDistance
            camera.position.set(
                center3.x + r * Math.cos(el) * Math.sin(az),
                center3.y + r * Math.sin(el) + size3.y * 0.1,
                center3.z + r * Math.cos(el) * Math.cos(az),
            )
            // Aim slightly above the car's center for that heroic look
            controls.target.set(center3.x, center3.y + size3.y * 0.1, center3.z)
        } else {
            camera.position.set(center3.x + dist, center3.y + dist * 0.6, center3.z + dist * 1.4)
            controls.target.copy(center3)
        }
        controls.update()
    }
}

function setupAnimations(gltf) {
    if (!gltf.animations || gltf.animations.length === 0) return
    mixer = new THREE.AnimationMixer(gltf.scene)
    gltf.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip) })

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
            carHome.position.copy(currentModel.position)
            carHome.rotationY = currentModel.rotation.y
            // Offset from the car's pivot to its lowest point (wheels), so
            // ground-follow rests the wheels on the road, not the pivot.
            const cbox = new THREE.Box3().setFromObject(currentModel)
            carGroundOffset = currentModel.position.y - cbox.min.y

            // Collect the wheel parent nodes so we can spin them while driving.
            // GLTFLoader sanitizes names, so they arrive as wheel / wheel001 / ...
            wheels.length = 0
            currentModel.traverse((o) => {
                if (/^wheel\d*$/.test(o.name)) wheels.push(o)
            })
            if (wheels.length) {
                currentModel.updateWorldMatrix(true, true)
                const wb = new THREE.Box3().setFromObject(wheels[0]).getSize(new THREE.Vector3())
                wheelRadius = Math.max(wb.x, wb.y, wb.z) / 2 || wheelRadius

                // Find the car's TRUE forward axis from its body parts (this model
                // came through FBX→glTF, so the nose is not a guessable axis).
                const localCenter = (name) => {
                    const o = currentModel.getObjectByName(name)
                    if (!o) return null
                    const b = new THREE.Box3().setFromObject(o)
                    return b.isEmpty() ? null : currentModel.worldToLocal(b.getCenter(new THREE.Vector3()))
                }
                const frontRef = localCenter('bump_front_ok') || localCenter('bonnet_ok') || localCenter('peredfar')
                const rearRef = localCenter('bump_rear_ok') || localCenter('boot_ok')
                let fwd = null
                if (frontRef && rearRef) {
                    fwd = frontRef.clone().sub(rearRef)
                    fwd.y = 0
                    fwd.normalize()
                    // Make the car drive nose-first: rotate its forward onto +Z
                    CONFIG.drive.headingOffset = -THREE.MathUtils.radToDeg(Math.atan2(fwd.x, fwd.z))
                }

                // Capture base orientation + classify front/rear by the real forward axis
                wheels.forEach((w) => {
                    w.userData.base = w.quaternion.clone()
                    const c = currentModel.worldToLocal(new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3()))
                    w.userData.front = fwd ? c.x * fwd.x + c.z * fwd.z > 0 : c.z < 0
                })
            }
        },
        undefined,
        (err) => console.error('Error loading model:', err),
    )
}

/**
 * Environment model (the map). All parts share ONE world coordinate system, so
 * they all get the SAME transform and assemble into the full city. The car sits
 * inside it. Transform is tuned live via the GUI.
 */
const envModels = []            // loaded part scenes
const envGroup = new THREE.Group() // convenience container for raycasting
scene.add(envGroup)

function applyEnvTransform() {
    const e = CONFIG.environment
    for (const m of envModels) {
        m.scale.setScalar(e.scale)
        m.position.set(e.position.x, e.position.y, e.position.z)
        m.rotation.y = THREE.MathUtils.degToRad(e.rotationY)
        m.updateMatrixWorld(true) // matrices are frozen, so update manually here
    }
}

function loadEnvironment() {
    const parts = CONFIG.environment.parts.filter((p) => p.enabled)
    parts.forEach((part) => {
        gltfLoader.load(
            part.path,
            (gltf) => {
                const model = gltf.scene
                model.userData.part = part.path
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.receiveShadow = true // the map catches the car's shadow
                        child.castShadow = false   // keep it cheap
                        child.geometry.computeBoundsTree() // BVH → fast ground raycast
                    }
                })
                envModels.push(model)
                envGroup.add(model)
                applyEnvTransform()
                // The map never moves — freeze its matrices so Three.js stops
                // recomputing world transforms for tens of thousands of static
                // meshes every frame (the real bottleneck at this object count).
                model.matrixWorldAutoUpdate = false
                console.log(`[MAP] loaded ${part.path.split('/').pop()} (${envModels.length}/${parts.length})`)
            },
            undefined,
            (err) => console.error('Error loading environment part:', part.path, err),
        )
    })
}

/**
 * Test track — a clean flat course for tuning the driving feel.
 * The drivable surfaces go into envGroup so the same ground-follow raycast works.
 */
function buildTestTrack() {
    const size = CONFIG.testTrack.size

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.95, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    envGroup.add(ground) // drivable ground for the raycast

    const grid = new THREE.GridHelper(size, size / 4, '#556', '#333')
    grid.position.y = 0.02
    scene.add(grid)

    // An oval loop to drive around
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(28, 40, 72),
        new THREE.MeshStandardMaterial({ color: '#3c3c44', roughness: 0.85, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    ring.receiveShadow = true
    scene.add(ring)

    // Start/finish stripe
    const line = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 2),
        new THREE.MeshStandardMaterial({ color: '#e6e6e6' }),
    )
    line.rotation.x = -Math.PI / 2
    line.position.set(34, 0.04, 0)
    scene.add(line)

    // Slalom cones for steering reference
    const coneGeo = new THREE.ConeGeometry(0.4, 1.2, 12)
    const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a00' })
    for (let i = 0; i < 9; i++) {
        const cone = new THREE.Mesh(coneGeo, coneMat)
        cone.position.set(-32 + i * 8, 0.6, 8)
        cone.castShadow = true
        scene.add(cone)
    }

    // Brighten it up so the track reads clearly (vs. the dark garage lighting)
    ambientLight.intensity = 0.7
    scene.fog = null
}

/**
 * Environment: reflective floor + moody garage lighting
 */
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#0d0b09', metalness: 0.35, roughness: 0.45 }),
)
floor.rotation.x = -Math.PI * 0.5
floor.receiveShadow = true
floor.visible = CONFIG.scene.showFloor
scene.add(floor)

const grid = new THREE.GridHelper(40, 40, '#3a2f22', '#241d15')
grid.visible = CONFIG.scene.showGrid
scene.add(grid)

// Soft warm ambience
const ambientLight = new THREE.AmbientLight('#ffe6c2', 0.12)
scene.add(ambientLight)

// Warm key spotlight from above-front (the garage hero light)
const keyLight = new THREE.SpotLight('#fff2d6', 18, 40, Math.PI * 0.3, 0.4, 1.2)
keyLight.position.set(4, 9, 6)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.camera.near = 1
keyLight.shadow.camera.far = 30
keyLight.shadow.bias = -0.0002
scene.add(keyLight)

// Cool rim light from behind for the paint edge highlight
const rimLight = new THREE.DirectionalLight('#5b7fff', 0.8)
rimLight.position.set(-6, 4, -6)
scene.add(rimLight)

// Warm fill from the opposite side
const fillLight = new THREE.DirectionalLight('#ff9d5c', 0.35)
fillLight.position.set(-4, 2, 5)
scene.add(fillLight)

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    composer.setSize(sizes.width, sizes.height)
    composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
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
controls.autoRotateSpeed = CONFIG.scene.autoRotateSpeed
controls.minPolarAngle = Math.PI * 0.15
controls.maxPolarAngle = Math.PI * 0.5 // don't let the camera dip under the floor

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = CONFIG.cinematic.exposure
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))

// Procedural studio environment → glossy, realistic reflections on the car paint
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = CONFIG.cinematic.envIntensity

/**
 * Post-processing ─ the "Most Wanted" cinematic grade
 */
// Custom color-grade + vignette pass
const GradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uWarmth: { value: CONFIG.cinematic.warmth },
        uContrast: { value: CONFIG.cinematic.contrast },
        uSaturation: { value: CONFIG.cinematic.saturation },
        uVignette: { value: CONFIG.cinematic.vignette },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uWarmth;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uVignette;

        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            vec3 c = tex.rgb;

            // Warm color grade (push reds/greens, pull blue)
            c.r += uWarmth * 0.9;
            c.g += uWarmth * 0.35;
            c.b -= uWarmth * 0.55;

            // Contrast around mid-grey
            c = (c - 0.5) * uContrast + 0.5;

            // Saturation
            float luma = dot(c, vec3(0.299, 0.587, 0.114));
            c = mix(vec3(luma), c, uSaturation);

            // Vignette
            vec2 uv = vUv - 0.5;
            float vig = smoothstep(0.85, 0.25, length(uv) * uVignette);
            c *= mix(0.55, 1.0, vig);

            gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
        }
    `,
}

const composer = new EffectComposer(renderer)
composer.setSize(sizes.width, sizes.height)
composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
composer.addPass(new RenderPass(scene, camera))

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(sizes.width, sizes.height),
    CONFIG.cinematic.bloom,          // strength
    0.5,                             // radius
    CONFIG.cinematic.bloomThreshold, // threshold
)
composer.addPass(bloomPass)

const gradePass = new ShaderPass(GradeShader)
composer.addPass(gradePass)
composer.addPass(new OutputPass())

/**
 * GUI
 */
let animationFolder = null
function buildAnimationGui(names, startName) {
    if (animationFolder) animationFolder.destroy()
    if (names.length === 0) return
    animationFolder = gui.addFolder('Animation')
    const state = { clip: startName }
    animationFolder.add(state, 'clip', names).name('Play clip').onChange((name) => {
        Object.values(actions).forEach((a) => a.fadeOut(0.2))
        actions[name]?.reset().fadeIn(0.2).play()
    })
}

const sceneFolder = gui.addFolder('Scene')
sceneFolder.add(controls, 'autoRotate').name('Auto-rotate')
sceneFolder.add(controls, 'autoRotateSpeed', 0, 3, 0.05).name('Rotate speed')
sceneFolder.add(floor, 'visible').name('Floor')
sceneFolder.add(grid, 'visible').name('Grid')
sceneFolder.addColor(CONFIG.scene, 'background').name('Background').onChange((v) => {
    scene.background.set(v)
    scene.fog.color.set(v)
})

// Live controls to place the map under the car
if (CONFIG.environment.enabled && !CONFIG.testTrack.enabled) {
    const envFolder = gui.addFolder('Environment (map)')
    const env = CONFIG.environment
    envFolder.add(envGroup, 'visible').name('Show map')
    envFolder.add(env, 'scale', 0.001, 2, 0.001).name('Scale').onChange(applyEnvTransform)
    envFolder.add(env.position, 'x', -500, 500, 0.5).name('Pos X').onChange(applyEnvTransform)
    envFolder.add(env.position, 'y', -200, 200, 0.5).name('Pos Y').onChange(applyEnvTransform)
    envFolder.add(env.position, 'z', -500, 500, 0.5).name('Pos Z').onChange(applyEnvTransform)
    envFolder.add(env, 'rotationY', -180, 180, 1).name('Rotate Y').onChange(applyEnvTransform)

    // Per-part visibility — flip heavy parts off if the frame rate drops
    const partsFolder = envFolder.addFolder('Parts (toggle for perf)')
    env.parts.forEach((p) => {
        const label = p.path.split('/').pop().replace(/.*part_/, 'part ').replace('.glb', '')
        partsFolder.add(p, 'enabled').name(label).onChange((v) => {
            const m = envModels.find((mm) => mm.userData.part === p.path)
            if (m) m.visible = v
        })
    })
    partsFolder.close()
}

const gradeFolder = gui.addFolder('Cinematic grade')
gradeFolder.add(bloomPass, 'strength', 0, 2, 0.01).name('Bloom')
gradeFolder.add(renderer, 'toneMappingExposure', 0.2, 2.5, 0.01).name('Exposure')
gradeFolder.add(gradePass.uniforms.uWarmth, 'value', -0.3, 0.4, 0.01).name('Warmth')
gradeFolder.add(gradePass.uniforms.uContrast, 'value', 0.5, 1.8, 0.01).name('Contrast')
gradeFolder.add(gradePass.uniforms.uSaturation, 'value', 0, 2, 0.01).name('Saturation')
gradeFolder.add(gradePass.uniforms.uVignette, 'value', 0.4, 2, 0.01).name('Vignette')

const lightFolder = gui.addFolder('Lighting')
lightFolder.add(ambientLight, 'intensity', 0, 3, 0.01).name('Ambient')
lightFolder.add(keyLight, 'intensity', 0, 150, 1).name('Key light')
lightFolder.add(rimLight, 'intensity', 0, 6, 0.01).name('Rim light')
lightFolder.close()

/**
 * Arcade driving
 */
const keys = {}
window.addEventListener('keydown', (e) => {
    keys[e.code] = true
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })

let carSpeed = 0
let carHeading = 0
let wheelSign = 1       // flip if the wheels appear to roll backwards
let wheelSpin = 0       // accumulated roll angle (around the axle, local X)
let steerAngle = 0      // smoothed visual steer angle of the front wheels (around up, local Y)
const _qSpin = new THREE.Quaternion()
const _qSteer = new THREE.Quaternion()
const _axAxle = new THREE.Vector3(1, 0, 0)
const _axUp = new THREE.Vector3(0, 1, 0)
const driveRaycaster = new THREE.Raycaster()
driveRaycaster.firstHitOnly = true // three-mesh-bvh: stop at the first surface
const DOWN = new THREE.Vector3(0, -1, 0)
let groundFrame = 0
const driveHint = document.querySelector('.drive-hint')

function enterDrive() {
    if (!currentModel) return
    controls.enabled = false
    controls.autoRotate = false
    // Always start from the road spot
    currentModel.position.copy(carHome.position)
    carHeading = carHome.rotationY
    carSpeed = 0
    // Pull in the far plane so the distant city is frustum-culled (fewer draw calls)
    camera.far = 130
    camera.updateProjectionMatrix()
    if (driveHint) driveHint.classList.add('is-visible')
}

function exitDrive() {
    controls.enabled = true
    camera.far = 200
    camera.updateProjectionMatrix()
    if (currentModel) {
        controls.target.copy(currentModel.position)
        controls.update()
    }
    if (driveHint) driveHint.classList.remove('is-visible')
}

function updateDrive(dt) {
    if (!currentModel) return
    const d = CONFIG.drive

    const throttle = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0
    const steerIn = (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0

    // Longitudinal speed with acceleration + coast-down friction
    if (throttle !== 0) carSpeed += throttle * d.accel * dt
    else {
        const fr = d.friction * dt
        carSpeed = carSpeed > 0 ? Math.max(0, carSpeed - fr) : Math.min(0, carSpeed + fr)
    }
    carSpeed = THREE.MathUtils.clamp(carSpeed, -d.reverseMax, d.maxSpeed)

    // Steering scales with speed; reverses when backing up
    const speedFactor = THREE.MathUtils.clamp(Math.abs(carSpeed) / d.maxSpeed, 0, 1)
    carHeading += steerIn * d.steer * dt * speedFactor * Math.sign(carSpeed || 1)

    // Move along heading
    const dir = new THREE.Vector3(Math.sin(carHeading), 0, Math.cos(carHeading))
    currentModel.position.addScaledVector(dir, carSpeed * dt)
    currentModel.rotation.y = carHeading + THREE.MathUtils.degToRad(d.headingOffset)

    // Wheels: rear pair rolls; front pair rolls AND steers.
    if (wheels.length) {
        wheelSpin += ((carSpeed * dt) / wheelRadius) * wheelSign
        // Smoothly ease the visual steer toward the input (max ~28°)
        const steerTarget = steerIn * THREE.MathUtils.degToRad(28)
        steerAngle = THREE.MathUtils.lerp(steerAngle, steerTarget, 0.2)
        _qSpin.setFromAxisAngle(_axAxle, wheelSpin)     // roll, around the axle (local X)
        _qSteer.setFromAxisAngle(_axUp, steerAngle)     // steer, around the car's vertical
        for (const w of wheels) {
            // steer in PARENT (car) space (pre-multiply) → pivots like a real kingpin;
            // spin in LOCAL axle space (post-multiply) → rolls on the steered axle.
            if (w.userData.front) w.quaternion.copy(_qSteer).multiply(w.userData.base).multiply(_qSpin)
            else w.quaternion.copy(w.userData.base).multiply(_qSpin)
        }
    }

    // Stick to the road surface (throttled raycast → smoothed). Cast a short ray
    // starting just above the car so it locks to the road it's on, not overpass
    // roofs high above, and rest the WHEELS (not the pivot) on the surface.
    if (d.groundFollow && envGroup.children.length && (groundFrame++ % 3 === 0)) {
        // Start just above the car so overhead structures (overpasses, beams) are
        // never hit — only the road below.
        const origin = new THREE.Vector3(currentModel.position.x, currentModel.position.y + 2, currentModel.position.z)
        driveRaycaster.set(origin, DOWN)
        driveRaycaster.far = 14
        const hits = driveRaycaster.intersectObject(envGroup, true)
        if (hits.length) {
            const targetY = hits[0].point.y + carGroundOffset
            currentModel.position.y = THREE.MathUtils.lerp(currentModel.position.y, targetY, 0.35)
        }
    }

    // Chase camera — follows the car holding the rear-3/4 "hero" angle. The
    // offset tracks the car's body rotation (heading + headingOffset).
    const camAz = THREE.MathUtils.degToRad(d.camAzimuth + d.headingOffset) + carHeading
    const camEl = THREE.MathUtils.degToRad(d.camElevation)
    const r = d.camDistance
    const desired = currentModel.position.clone().add(new THREE.Vector3(
        r * Math.cos(camEl) * Math.sin(camAz),
        r * Math.sin(camEl) + 0.4,
        r * Math.cos(camEl) * Math.cos(camAz),
    ))
    camera.position.lerp(desired, 1 - Math.pow(0.0015, dt))
    camera.lookAt(currentModel.position.x, currentModel.position.y + 0.6, currentModel.position.z)
}

const driveFolder = gui.addFolder('Drive (WASD)')
driveFolder.add(CONFIG.drive, 'enabled').name('Drive mode').onChange((v) => (v ? enterDrive() : exitDrive()))
driveFolder.add(CONFIG.drive, 'maxSpeed', 2, 30, 0.5).name('Top speed')
driveFolder.add(CONFIG.drive, 'steer', 0.5, 4, 0.1).name('Steering')
driveFolder.add(CONFIG.drive, 'groundFollow').name('Follow road')
driveFolder.add(CONFIG.drive, 'headingOffset', -180, 180, 90).name('Nose align')

/**
 * Load model(s) + render loop
 */
loadModel(CONFIG.model.path)
if (CONFIG.testTrack.enabled) buildTestTrack()
else if (CONFIG.environment.enabled) loadEnvironment()

const clock = new THREE.Clock()
let previousTime = 0

const tick = () => {
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime

    if (mixer) mixer.update(deltaTime)

    if (CONFIG.drive.enabled) updateDrive(deltaTime)
    else controls.update()

    if (CONFIG.cinematic.enabled) {
        composer.render()
    } else {
        renderer.render(scene, camera)
    }
    window.requestAnimationFrame(tick)
}

tick()
