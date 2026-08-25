/**
 * Shared tunables for the Burnout-style prototype (R3F port).
 *
 * TUNING and CAMERA are LIVE, mutable objects — the lil-gui tuning panel mutates
 * them in place while driving, and the physics/camera loops read them every
 * frame. Keep them as plain module singletons (not React state) so mutation is
 * zero-cost and never triggers a re-render.
 */

// ── Physics core ──────────────────────────────────────────────────────────────
export const FIXED_DT = 1 / 60
export const GRAVITY = [0, -13.5, 0] // slightly heavy = arcade planted feel

/** true = drive the real Burnout Revenge circuit; false = procedural highway. */
export const USE_CIRCUIT = true

/**
 * true = drive a procedurally-built Track (road ribbon + barriers generated from
 * a centerline, so road/wall/spawn are known by construction) instead of the
 * ripped circuit. This is the path that fixes wall-climbing/getting-stuck.
 */
export const USE_TRACK = false

/**
 * Closed-loop centerline for the procedural track, as [x, z] metres. A flowing
 * city circuit — long straights, sweepers, and a lower S-kink — in the spirit of
 * the Rockport layout. Retrace these points to match an exact loop from a map.
 */
export const TRACK = {
    roadWidth: 18,     // wall-to-wall (m) — wide/arcade so 190 km/h is forgiving
    wallHeight: 4,     // barrier height (m) — tall enough not to fly over at speed
    samples: 600,      // ribbon resolution around the loop
    points: [
        [380, 0], [350, 200], [210, 330], [10, 350], [-190, 300], [-340, 160],
        [-380, -40], [-290, -220], [-100, -270], [70, -220], [140, -360],
        [320, -330], [430, -150],
    ],
}

// Wall scrape: hard hits bleed speed instead of triggering a crash.
export const SCRAPE_DELTA_V = 6
export const SCRAPE_PENALTY = 0.55

// ── Vehicle tuning (Burnout-style arcade feel) ────────────────────────────────
export const TUNING = {
    mass: 1000,
    enginePower: 14000,
    brakeForce: 55,
    maxSpeed: 56,            // ~200 km/h
    boostMaxSpeed: 72,       // ~260 km/h on boost
    steerMax: 0.55,
    steerFalloff: 0.026,
    steerLerp: 15,
    suspension: { rest: 0.3, stiffness: 58, compression: 3.2, relaxation: 4.0, travel: 0.2 },
    grip: 4.4,
    sideGrip: 3.2,
    driftGripRear: 0.55,
    driftSideRear: 0.14,
    driftYawKick: 560,
    boostAccel: 18,
    boostDrain: 30,
    boostRegen: 13,
    boostOnCheck: 30,
}

export const HALF = { w: 0.92, h: 0.5, l: 2.2 } // chassis half-extents (m)

/**
 * Car registry. Each rip names its parts differently and faces a different way.
 *  wheelPattern  matches the four wheel PARENT nodes (GLTFLoader strips dots)
 *  modelYaw      rotation to bring the model's nose onto the rig's +Z forward
 */
export const CARS = {
    r190: {
        name: 'Factory R190 GT',
        path: '/models/cars/factory_r190_gt_burnout_revenge.glb',
        wheelPattern: /^Car1C_mesh_9\d{0,3}$/,
        modelYaw: 0,
        stats: { weight: 'LIGHT', boostMph: 209, crashbreaker: 'FORCE 1' },
        tuning: { mass: 950, grip: 4.4, sideGrip: 3.2, maxSpeed: 56, boostMaxSpeed: 72 },
    },
    bmw: {
        name: 'BMW M3 GTR',
        path: '/models/bmw_m3_gtr_-_nfs_mw.glb',
        wheelPattern: /^wheel\d*$/,
        modelYaw: Math.PI,
        stats: { weight: 'MEDIUM', boostMph: 196, crashbreaker: 'FORCE 2' },
        tuning: { mass: 1100, grip: 4.8, sideGrip: 3.5, maxSpeed: 53, boostMaxSpeed: 68 },
    },
}

// ── Camera / FX (live-tunable) ────────────────────────────────────────────────
export const CAMERA = {
    azimuth: 0,
    dist: 4.4,
    height: 1.3,
    lookAhead: 12,
    lookHeight: 1.25,
    fovBase: 54,
    fovSpeed: 14,
    fovBoost: 10,
    shakeStart: 0.72,
    shakeAmp: 0.06,
    blurMax: 0.05,
    followLag: 0.0008,
}

// ── Procedural highway (only used when USE_CIRCUIT === false) ──────────────────
export const ROAD = {
    length: 3000,
    width: 25,
    WRAP: 2600,
    lanes: [{ x: -2.2, dir: 1, speed: 12 }],
}

// ── Circuit ───────────────────────────────────────────────────────────────────
export const CIRCUIT = {
    // The Rockport rip is split across several GLBs (export/size limit) — load
    // and merge all of them so the streets these parts border actually connect.
    path: [
        '/models/maps/opt/nfs_most_wanted_2005_-_rockport_map_part_1.glb',
        '/models/maps/opt/nfs_most_wanted_-_rockport_map_part_2.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_3.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_5.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_6.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_7.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_10.glb',
        '/models/maps/opt/nfs_most_wanted_rockport_map_part_11.glb',
    ],
    TARGET_SPAN: 3100,
}
