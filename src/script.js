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
        enabled: true,      // start in drive mode (chase cam uses the hero framing)
        // Physics in real-world units (km/h, m/s²). Scene scale is derived from
        // the car's real length so speeds and distances are believable.
        maxKmh: 200,        // top speed
        reverseKmh: 35,
        accel: 8,           // m/s² engine acceleration (tapers toward top speed)
        brakeDecel: 22,     // m/s² braking
        coastDecel: 3.5,    // m/s² engine braking when off the throttle
        maxSteerDeg: 24,    // front-wheel steering lock
        groundFollow: true, // raycast down onto the map so it follows hills
        headingOffset: 0,   // degrees, auto-set at load to align the nose with travel
        mute: false,        // engine sound
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
let carFitDist = 3      // camera distance that frames the car (set in frameModel)
let carSizeY = 1        // car height, for the small look-up offset
let carWorldLength = 2  // car length in world units (set in frameModel)
let metersPerUnit = 2.235 // scene scale: real metres per world unit
let wheelbaseWorld = 1.2  // front↔rear axle distance (world units)
const REAL_CAR_LENGTH_M = 4.47 // BMW M3 E46 length, used to scale the world

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
        carFitDist = dist       // reused by the drive chase camera
        carSizeY = size3.y
        carWorldLength = maxDim // real-world scale is derived from this
        metersPerUnit = REAL_CAR_LENGTH_M / carWorldLength
        wheelbaseWorld = carWorldLength * 0.58

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
                    // True vertical steering axis, expressed in the wheel's (possibly
                    // tilted) parent space, so front wheels pivot flat like a kingpin.
                    w.userData.steerAxis = new THREE.Vector3(0, 1, 0)
                        .applyQuaternion(w.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
                        .normalize()
                })
            }
            if (CONFIG.drive.enabled) enterDrive() // start driving straight away
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

let skyMaterial = null   // animated sky (clouds drift)
let grassMaterial = null // animated grass (wind + reacts to the car)

/**
 * Sunset drive — an open field of wind-blown grass under a soft pastel sky,
 * so the car looks like it's cruising through a meadow at dusk. The grass bends
 * away from the car as it passes. The ground goes into envGroup so the same
 * ground-follow raycast keeps the wheels planted.
 */
function buildTestTrack() {
    // ── Soft pastel sky with drifting clouds ──────────────────────────────────
    skyMaterial = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 },
            uZenith: { value: new THREE.Color('#8fa6c4') },   // soft blue-grey top
            uMid: { value: new THREE.Color('#d9b6c6') },      // lavender-pink band
            uHorizon: { value: new THREE.Color('#f7c7a3') },  // warm peach horizon
            uGround: { value: new THREE.Color('#cdb79a') },   // hazy below horizon
            uCloudLit: { value: new THREE.Color('#fbe3d4') }, // sunlit cloud
            uCloudShad: { value: new THREE.Color('#9d9bb0') },// cloud shadow
        },
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vDir;
            uniform float uTime;
            uniform vec3 uZenith, uMid, uHorizon, uGround, uCloudLit, uCloudShad;
            float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
            float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
                return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
            float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02; a*=0.5; } return v; }
            void main(){
                float h = clamp(vDir.y, -1.0, 1.0);
                // vertical gradient: horizon → mid band → zenith (and haze below)
                vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
                col = mix(col, uZenith, smoothstep(0.30, 0.9, h));
                col = mix(uGround, col, smoothstep(-0.15, 0.02, h));
                // wispy clouds, projected onto the sky and drifting over time
                vec2 uv = vDir.xz / max(h + 0.28, 0.12);
                float clouds = fbm(uv * 1.1 + vec2(uTime * 0.008, uTime * 0.003));
                clouds = smoothstep(0.42, 0.95, clouds);
                float band = smoothstep(0.02, 0.22, h) * smoothstep(1.0, 0.32, h); // keep to mid-sky
                float amt = clouds * band;
                vec3 cloudCol = mix(uCloudShad, uCloudLit, smoothstep(0.3, 0.9, clouds));
                col = mix(col, cloudCol, amt * 0.85);
                gl_FragColor = vec4(col, 1.0);
            }
        `,
    })
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), skyMaterial))

    // ── Ground (drivable) ─────────────────────────────────────────────────────
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000),
        new THREE.MeshStandardMaterial({ color: '#4b6b34', roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    envGroup.add(ground) // drivable surface for the ground-follow raycast

    // ── Soft dusk lighting ────────────────────────────────────────────────────
    keyLight.visible = false
    const sunLight = new THREE.DirectionalLight('#ffd9b0', 2.0)
    sunLight.position.set(-40, 22, -120) // low, warm, from the horizon
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(2048, 2048)
    sunLight.shadow.camera.near = 1
    sunLight.shadow.camera.far = 120
    sunLight.shadow.camera.left = -20
    sunLight.shadow.camera.right = 20
    sunLight.shadow.camera.top = 20
    sunLight.shadow.camera.bottom = -20
    sunLight.shadow.bias = -0.0003
    scene.add(sunLight)

    ambientLight.color.set('#cfd6e6')
    ambientLight.intensity = 0.7
    rimLight.color.set('#ffc79e')
    rimLight.intensity = 1.1
    rimLight.position.set(-30, 6, -140)
    fillLight.color.set('#bcd0e0')
    fillLight.intensity = 0.35

    scene.background = new THREE.Color('#e9c3a6')
    scene.fog = new THREE.Fog('#e9c9b4', 90, 520) // soft dusk haze

    camera.far = 3000 // see the sky dome
    camera.updateProjectionMatrix()
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
    startEngineSound() // browsers need a user gesture to start audio
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })

/**
 * Engine sound — a synthesized engine (Web Audio) whose pitch/volume track the
 * revs. If you drop a real engine loop at /sounds/engine.mp3 it's used instead,
 * with its playback rate driven by the revs (swap the placeholder for a BMW).
 */
let audioCtx = null
let engine = null // { master, osc1, osc2, sub, filter } | { el } for a real sample
const engineFile = new Audio('/sounds/engine.mp3')
engineFile.loop = true
let engineFileOk = false
engineFile.addEventListener('canplaythrough', () => { engineFileOk = true })

function startEngineSound() {
    if (engine || CONFIG.drive.mute) return
    if (engineFileOk) {
        engineFile.volume = 0
        engineFile.play().catch(() => {})
        engine = { el: engineFile }
        return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    audioCtx = new Ctx()
    const master = audioCtx.createGain(); master.gain.value = 0; master.connect(audioCtx.destination)
    const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700; filter.connect(master)
    const osc1 = audioCtx.createOscillator(); osc1.type = 'sawtooth'; osc1.connect(filter)
    const osc2 = audioCtx.createOscillator(); osc2.type = 'square'; osc2.detune.value = -8; osc2.connect(filter)
    const sub = audioCtx.createOscillator(); sub.type = 'sine'; sub.connect(filter)
    osc1.start(); osc2.start(); sub.start()
    engine = { master, osc1, osc2, sub, filter }
}

function updateEngineSound(rev, throttle) {
    if (!engine || CONFIG.drive.mute) return
    if (engine.el) {
        engine.el.playbackRate = 0.7 + rev * 1.8
        engine.el.volume = Math.min(1, 0.25 + rev * 0.55)
        return
    }
    const t = audioCtx.currentTime
    const freq = 42 + rev * 165 + (throttle > 0 ? 16 : 0)
    engine.osc1.frequency.setTargetAtTime(freq, t, 0.04)
    engine.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.04)
    engine.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.04)
    engine.filter.frequency.setTargetAtTime(500 + rev * 2200, t, 0.05)
    const vol = 0.05 + rev * 0.16 + (throttle > 0 ? 0.05 : 0)
    engine.master.gain.setTargetAtTime(vol, t, 0.08)
}

const speedoEl = document.querySelector('#kmh')
const speedoBox = document.querySelector('.speedo')

let speedMS = 0         // longitudinal speed in metres/sec (signed)
let carHeading = 0
let wheelSign = -1      // roll direction (flip if the wheels appear to spin backwards)
let wheelSpin = 0       // accumulated roll angle (around the axle, local X)
let steerAngle = 0      // smoothed visual steer angle of the front wheels (around up, local Y)
let chaseSnap = false   // snap (don't lerp) the chase camera on the first frame
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
    // Always start from the spawn spot
    currentModel.position.copy(carHome.position)
    carHeading = carHome.rotationY
    speedMS = 0
    chaseSnap = true
    // Pull in the far plane to frustum-cull the distant CITY (not the open scenes)
    if (!CONFIG.testTrack.enabled) {
        camera.far = 130
        camera.updateProjectionMatrix()
    }
    if (driveHint) driveHint.classList.add('is-visible')
    if (speedoBox) speedoBox.classList.add('is-visible')
}

function exitDrive() {
    controls.enabled = true
    if (!CONFIG.testTrack.enabled) {
        camera.far = 200
        camera.updateProjectionMatrix()
    }
    if (currentModel) {
        controls.target.copy(currentModel.position)
        controls.update()
    }
    if (driveHint) driveHint.classList.remove('is-visible')
    if (speedoBox) speedoBox.classList.remove('is-visible')
}

function updateDrive(dt) {
    if (!currentModel) return
    const d = CONFIG.drive

    const throttle = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0
    const steerIn = (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0

    const maxMS = d.maxKmh / 3.6
    const revMS = d.reverseKmh / 3.6

    // Longitudinal dynamics (m/s). Engine force tapers toward top speed (power +
    // drag balance), braking is strong, and it coasts down off the throttle.
    let a
    if (throttle > 0) a = d.accel * (1 - THREE.MathUtils.clamp(speedMS / maxMS, 0, 1))
    else if (throttle < 0) {
        a = speedMS > 0.3 ? -d.brakeDecel
            : -d.accel * 0.55 * (1 - THREE.MathUtils.clamp(-speedMS / revMS, 0, 1))
    } else {
        a = -Math.sign(speedMS) * d.coastDecel
    }
    speedMS += a * dt
    if (throttle === 0 && Math.abs(speedMS) < d.coastDecel * dt) speedMS = 0 // settle to a stop
    speedMS = THREE.MathUtils.clamp(speedMS, -revMS, maxMS)

    const worldVel = speedMS / metersPerUnit // world units / sec

    // Steering: ease the front wheels to their target angle, then turn the car
    // with a bicycle model (turn radius = wheelbase / tan(steer); yaw ∝ speed).
    const steerTarget = steerIn * THREE.MathUtils.degToRad(d.maxSteerDeg)
    steerAngle = THREE.MathUtils.lerp(steerAngle, steerTarget, 1 - Math.pow(0.0009, dt))
    carHeading += (worldVel / wheelbaseWorld) * Math.tan(steerAngle) * dt

    // Move along heading
    const dir = new THREE.Vector3(Math.sin(carHeading), 0, Math.cos(carHeading))
    currentModel.position.addScaledVector(dir, worldVel * dt)
    currentModel.rotation.y = carHeading + THREE.MathUtils.degToRad(d.headingOffset)

    // Wheels: rear pair rolls; front pair rolls AND steers.
    if (wheels.length) {
        wheelSpin += ((worldVel * dt) / wheelRadius) * wheelSign
        _qSpin.setFromAxisAngle(_axAxle, wheelSpin)     // roll, around the axle (local X)
        for (const w of wheels) {
            if (w.userData.front) {
                // steer around the wheel's true vertical (pre-multiply) → flat kingpin
                // pivot; spin around the axle (post-multiply) → rolls on the steered axle.
                _qSteer.setFromAxisAngle(w.userData.steerAxis, steerAngle)
                w.quaternion.copy(_qSteer).multiply(w.userData.base).multiply(_qSpin)
            } else {
                w.quaternion.copy(w.userData.base).multiply(_qSpin)
            }
        }
    }

    // HUD + engine sound
    const rev = THREE.MathUtils.clamp(Math.abs(speedMS) / maxMS, 0, 1)
    if (speedoEl) speedoEl.textContent = Math.round(Math.abs(speedMS) * 3.6)
    updateEngineSound(rev, throttle)

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

    // Chase camera — holds the SAME framing as the default hero angle, so drive
    // mode doesn't jump the camera; it just tracks the car's body rotation.
    const cam = CONFIG.camera
    const camAz = THREE.MathUtils.degToRad(cam.heroAzimuth + d.headingOffset) + carHeading
    const camEl = THREE.MathUtils.degToRad(cam.heroElevation)
    const r = carFitDist * cam.heroDistance
    const yBump = carSizeY * 0.1
    const desired = currentModel.position.clone().add(new THREE.Vector3(
        r * Math.cos(camEl) * Math.sin(camAz),
        r * Math.sin(camEl) + yBump,
        r * Math.cos(camEl) * Math.cos(camAz),
    ))
    if (chaseSnap) { camera.position.copy(desired); chaseSnap = false }
    else camera.position.lerp(desired, 1 - Math.pow(0.0015, dt))
    camera.lookAt(currentModel.position.x, currentModel.position.y + yBump, currentModel.position.z)
}

const driveFolder = gui.addFolder('Drive (WASD)')
driveFolder.add(CONFIG.drive, 'enabled').name('Drive mode').onChange((v) => (v ? enterDrive() : exitDrive()))
driveFolder.add(CONFIG.drive, 'maxKmh', 60, 320, 5).name('Top speed (km/h)')
driveFolder.add(CONFIG.drive, 'accel', 3, 16, 0.5).name('Acceleration')
driveFolder.add(CONFIG.drive, 'maxSteerDeg', 15, 45, 1).name('Steering lock')
driveFolder.add(CONFIG.drive, 'groundFollow').name('Follow road')
driveFolder.add(CONFIG.drive, 'mute').name('Mute engine')
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

    // Animate the sky (clouds drift) and grass (wind + reacts to the car)
    if (skyMaterial) skyMaterial.uniforms.uTime.value = elapsedTime
    if (grassMaterial) {
        grassMaterial.uniforms.uTime.value = elapsedTime
        if (currentModel) grassMaterial.uniforms.uCarPos.value.copy(currentModel.position)
    }

    if (CONFIG.cinematic.enabled) {
        composer.render()
    } else {
        renderer.render(scene, camera)
    }
    window.requestAnimationFrame(tick)
}

tick()
