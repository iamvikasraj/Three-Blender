import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TRACK } from './constants.js'
import { telemetry } from './telemetry.js'

/**
 * Live minimap. Because the track is generated from a centerline, we draw the
 * exact loop here (same Catmull-Rom curve) and plot the car on it. The path is
 * static; the car marker is moved/rotated from its own rAF loop reading the
 * telemetry singleton, so it never re-renders React.
 */
const VIEW = 100   // svg viewBox units
const MARGIN = 10

export function Minimap() {
    const markerRef = useRef(null)

    // Loop path + world→minimap mapping, computed once.
    const { path, map } = useMemo(() => {
        const curve = new THREE.CatmullRomCurve3(
            TRACK.points.map((p) => new THREE.Vector3(p[0], 0, p[1])), true, 'catmullrom', 0.5,
        )
        const pts = curve.getSpacedPoints(220)
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (const p of pts) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
        }
        const span = Math.max(maxX - minX, maxZ - minZ) || 1
        const s = (VIEW - 2 * MARGIN) / span
        // +z maps UP the screen (north-up), so the minimap reads like the map.
        const mapX = (x) => MARGIN + (x - minX) * s
        const mapY = (z) => VIEW - (MARGIN + (z - minZ) * s)

        let d = ''
        pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${mapX(p.x).toFixed(1)} ${mapY(p.z).toFixed(1)}` })
        d += 'Z'
        return { path: d, map: { mapX, mapY } }
    }, [])

    useEffect(() => {
        let raf
        const loop = () => {
            const g = markerRef.current
            if (g) {
                const cx = map.mapX(telemetry.x)
                const cy = map.mapY(telemetry.z)
                const deg = telemetry.heading * 180 / Math.PI
                g.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${deg.toFixed(1)})`)
            }
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [map])

    return (
        <div className="minimap">
            <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width="100%" height="100%">
                <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4"
                    strokeLinejoin="round" strokeLinecap="round" />
                <g ref={markerRef}>
                    {/* up-pointing triangle → rotate(headingDeg) aims it along travel */}
                    <polygon points="0,-4.5 3,4 -3,4" fill="#ffc400" stroke="#1a1a1a" strokeWidth="0.8" />
                </g>
            </svg>
        </div>
    )
}
