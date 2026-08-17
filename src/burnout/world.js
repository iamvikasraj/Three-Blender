import * as THREE from 'three'
import { world, RAPIER } from './physics.js'

/**
 * The highway — a straight dusk freeway built for speed-reading:
 * dashed lines, lamp posts and buildings repeat with a period that matches the
 * endless-wrap distance (WRAP), so teleporting the car back is invisible.
 */
export const ROAD = {
    length: 3000,      // total visual road length (centered on z = 0)
    width: 25,         // wall to wall
    WRAP: 2600,        // endless wrap period — prop spacings must divide this
    lanes: [           // ONE stream of slow traffic to weave around; rest of the road is yours
        { x: -2.2, dir: 1, speed: 12 },
    ],
}

/**
 * @param {object} opts
 * @param {boolean} opts.road  build the procedural highway (false when a real
 *                             circuit model provides the drivable geometry)
 * @param {'sunset'|'daylight'} opts.sky
 *        'sunset'   synthwave magenta dusk (suits the procedural highway)
 *        'daylight' bright overcast — matches maps whose textures are baked
 *                   for daylight, e.g. the Eternal City circuit
 */
/** Bright overcast daylight — matches maps with daylight-baked textures. */
function setupDaylight(scene) {
    scene.background = new THREE.Color('#e8ecef')
    scene.fog = new THREE.Fog('#dfe4e8', 400, 2600)

    // Flat daylight fill — enough to read the baked textures without blowing
    // the light surfaces out to pure white.
    scene.add(new THREE.HemisphereLight('#eaf2ff', '#b0a89c', 1.5))
    scene.add(new THREE.AmbientLight('#ffffff', 0.35))

    const sun = new THREE.DirectionalLight('#fff4e2', 1.5)
    sun.position.set(-260, 420, 180)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 1000
    sun.shadow.camera.left = -150
    sun.shadow.camera.right = 150
    sun.shadow.camera.top = 150
    sun.shadow.camera.bottom = -150
    sun.shadow.bias = -0.0006
    scene.add(sun, sun.target)
    return { sun }
}

export function buildWorld(scene, opts = {}) {
    const { road = true, sky: skyPreset = 'sunset' } = opts
    const L = ROAD.length

    if (skyPreset === 'daylight') {
        const { sun } = setupDaylight(scene)
        if (!road) return { sun }
        return buildHighway(scene, sun)
    }

    // ── Synthwave sunset: magenta sky dome, giant low sun, purple haze ───────
    scene.fog = new THREE.Fog('#b0487e', 70, 460)

    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1600, 32, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            fog: false,
            depthWrite: false,
            uniforms: {
                uTop: { value: new THREE.Color('#6e2170') },     // deep magenta-purple zenith
                uMid: { value: new THREE.Color('#e0518e') },     // hot pink
                uHorizon: { value: new THREE.Color('#ffb46a') }, // orange-gold at the horizon
            },
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: /* glsl */`
                varying vec3 vDir; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
                void main() {
                    float h = max(vDir.y, 0.0);
                    vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
                    c = mix(c, uTop, smoothstep(0.18, 0.75, h));
                    gl_FragColor = vec4(c, 1.0);
                }
            `,
        }),
    )
    scene.add(sky)

    // Giant pale sun sitting on the horizon ahead, with a soft pink halo
    const sunDisc = new THREE.Mesh(
        new THREE.CircleGeometry(150, 64),
        new THREE.MeshBasicMaterial({ color: '#fff3b0', fog: false }),
    )
    sunDisc.position.set(120, 95, 1500)
    sunDisc.lookAt(0, 40, 0)
    scene.add(sunDisc)
    const halo = new THREE.Mesh(
        new THREE.CircleGeometry(230, 64),
        new THREE.MeshBasicMaterial({
            color: '#ff8fae', fog: false, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }),
    )
    halo.position.copy(sunDisc.position)
    halo.position.z += 10
    halo.lookAt(0, 40, 0)
    scene.add(halo)

    const hemi = new THREE.HemisphereLight('#ff9ad0', '#2a1030', 0.85)
    scene.add(hemi)

    const sun = new THREE.DirectionalLight('#ffc98a', 1.9)
    sun.position.set(30, 30, 140) // low, from the sun's direction ahead
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 160
    sun.shadow.camera.left = -30
    sun.shadow.camera.right = 30
    sun.shadow.camera.top = 30
    sun.shadow.camera.bottom = -30
    sun.shadow.bias = -0.0004
    scene.add(sun)
    scene.add(sun.target)

    if (!road) return { sun } // a real circuit supplies the drivable geometry
    return buildHighway(scene, sun)
}

/** The procedural endless highway (road, markings, barriers, props). */
function buildHighway(scene, sun) {
    const L = ROAD.length

    // ── Road surface + shoulders ─────────────────────────────────────────────
    const asphalt = new THREE.Mesh(
        new THREE.PlaneGeometry(ROAD.width, L),
        new THREE.MeshStandardMaterial({ color: '#2e2138', roughness: 0.92 }),
    )
    asphalt.rotation.x = -Math.PI / 2
    asphalt.receiveShadow = true
    scene.add(asphalt)

    const shoulder = new THREE.Mesh(
        new THREE.PlaneGeometry(400, L),
        new THREE.MeshStandardMaterial({ color: '#241030', roughness: 1 }),
    )
    shoulder.rotation.x = -Math.PI / 2
    shoulder.position.y = -0.02
    scene.add(shoulder)

    // Ground collider
    world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, L / 2).setTranslation(0, -0.5, 0).setFriction(1.0))

    // ── Lane markings (instanced dashes; 8 m pitch divides WRAP) ─────────────
    const dashGeo = new THREE.PlaneGeometry(0.18, 3)
    dashGeo.rotateX(-Math.PI / 2)
    const dashMat = new THREE.MeshBasicMaterial({ color: '#cfcfe0' })
    const dividers = [-4.4, 0, 4.4]
    const perDiv = Math.floor(L / 8)
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, perDiv * dividers.length)
    const m4 = new THREE.Matrix4()
    let di = 0
    for (const dx of dividers) {
        for (let i = 0; i < perDiv; i++) {
            m4.makeTranslation(dx, 0.015, -L / 2 + i * 8)
            dashes.setMatrixAt(di++, m4)
        }
    }
    scene.add(dashes)

    // Solid edge lines
    for (const ex of [-ROAD.width / 2 + 0.8, ROAD.width / 2 - 0.8]) {
        const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(0.22, L),
            new THREE.MeshBasicMaterial({ color: '#b8b02c' }),
        )
        edge.rotation.x = -Math.PI / 2
        edge.position.set(ex, 0.012, 0)
        scene.add(edge)
    }

    // ── Barriers (visual + colliders) ────────────────────────────────────────
    const barrierMat = new THREE.MeshStandardMaterial({ color: '#553a5e', roughness: 0.8 })
    for (const side of [-1, 1]) {
        const bx = side * (ROAD.width / 2 + 0.5)
        const barrier = new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, L), barrierMat)
        barrier.position.set(bx, 0.55, 0)
        scene.add(barrier)
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, 1.2, L / 2).setTranslation(bx, 0.6, 0).setFriction(0.1),
        )
    }

    // ── Lamp posts (50 m pitch divides WRAP) + head glow ─────────────────────
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 8)
    const postMat = new THREE.MeshStandardMaterial({ color: '#3a2a44' })
    const posts = Math.floor(L / 50) * 2
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts)
    const lampGeo = new THREE.SphereGeometry(0.22, 8, 6)
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' })
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, posts)
    let pi = 0
    for (let i = 0; i < posts / 2; i++) {
        for (const side of [-1, 1]) {
            const x = side * (ROAD.width / 2 + 1.6)
            const z = -L / 2 + i * 50 + (side > 0 ? 25 : 0)
            m4.makeTranslation(x, 3, z); postMesh.setMatrixAt(pi, m4)
            m4.makeTranslation(x, 6, z); lampMesh.setMatrixAt(pi, m4)
            pi++
        }
    }
    scene.add(postMesh, lampMesh)

    // ── Buildings (65 m pitch × 40 pattern = 2600 = WRAP, so wraps line up) ──
    const bldMat = new THREE.MeshStandardMaterial({ color: '#2c1440', roughness: 0.95 }) // purple silhouettes
    const seeded = (i) => { const s = Math.sin(i * 127.13) * 43758.5453; return s - Math.floor(s) }
    const buildings = []
    for (let i = 0; i < Math.floor(L / 65); i++) {
        for (const side of [-1, 1]) {
            const k = (i % 40) * 2 + (side > 0 ? 1 : 0) // repeating pattern seed
            const w = 8 + seeded(k) * 14
            const h = 10 + seeded(k + 0.5) * 42
            const x = side * (ROAD.width / 2 + 14 + seeded(k + 0.25) * 18)
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10 + seeded(k + 0.75) * 20), bldMat)
            b.position.set(x, h / 2, -L / 2 + i * 65)
            buildings.push(b)
        }
    }
    const bGroup = new THREE.Group()
    buildings.forEach((b) => bGroup.add(b))
    scene.add(bGroup)

    return { sun }
}
