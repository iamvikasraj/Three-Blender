/**
 * The two drivable maps. Green Hills (default) runs a big Nürburgring-inspired
 * circuit; Sunset Coast a flowing loop. `loop` is the closed centerline (metres)
 * that gets extruded into the road and followed by the car.
 *
 * The Nürburgring loop approximates the Nordschleife's overall shape — the tall
 * teardrop with the long back straight — not its exact 150-odd corners.
 */
export const MAPS = [
    {
        id: 'hills',
        name: 'GREEN HILLS',
        sky: { top: '#14867a', mid: '#4fb89e', horizon: '#dcecc6' },
        fog: '#bfe0c2', fogNear: 200, fogFar: 2600,
        sun: '#eef6e6', halo: '#a9e0bd',
        hemi: ['#a8e0c0', '#1e3a2b', 0.9], dir: '#eaf6d8', dirIntensity: 1.7,
        ground: '#3f7a3a', road: '#5d616a', dash: '#f2f7ec',
        prop: 'pylon',
        loop: [
            [150, -560], [350, -540], [480, -440], [540, -260], [560, -40],
            [560, 220], [540, 440], [470, 620], [350, 760], [180, 850],
            [0, 900], [-160, 870], [-260, 740], [-300, 560], [-280, 380],
            [-320, 200], [-300, 20], [-260, -140], [-300, -320], [-140, -460], [0, -520],
        ],
    },
    {
        id: 'coast',
        name: 'SUNSET COAST',
        sky: { top: '#6e2170', mid: '#e0518e', horizon: '#ffb46a' },
        fog: '#b0487e', fogNear: 200, fogFar: 2400,
        sun: '#fff3b0', halo: '#ff8fae',
        hemi: ['#ff9ad0', '#2a1030', 0.85], dir: '#ffc98a', dirIntensity: 1.9,
        ground: '#3a1e3e', road: '#565060', dash: '#f7ecd6',
        prop: 'palm',
        loop: [
            [420, 0], [380, 220], [220, 360], [0, 380], [-220, 320],
            [-380, 140], [-400, -120], [-300, -320], [-80, -400], [160, -360],
            [340, -220], [440, -80],
        ],
    },
]
