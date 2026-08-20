/**
 * Car paint variants. `carHue` is a single uniform shared by every car material
 * (see ps1CarModel); switching paint just mutates its value. Hue is a rotation
 * in radians around the grey axis — 0 keeps the original blue, ~2.1 (120°) spins
 * blue round to red.
 */
export const carHue = { value: 0 }

export const PAINTS = [
    { name: 'BLUE', hue: 0 },
    { name: 'RED', hue: 2.1 },
]
