import { useEffect, useRef } from 'react'
import { telemetry } from './telemetry.js'
import { Minimap } from './Minimap.jsx'
import { USE_TRACK } from './constants.js'

/**
 * Race HUD (speed, boost meter, crash banner). Reads the telemetry singleton
 * from its own rAF loop and writes straight to the DOM, so the per-frame stream
 * of numbers never re-renders React.
 */
export function Hud() {
    const kmh = useRef(null)
    const boost = useRef(null)
    const fill = useRef(null)
    const banner = useRef(null)

    useEffect(() => {
        let raf
        const loop = () => {
            if (kmh.current) kmh.current.textContent = telemetry.speedKmh
            if (fill.current) fill.current.style.transform = `scaleX(${telemetry.boost01})`
            boost.current?.classList.toggle('is-active', telemetry.boosting)
            banner.current?.classList.toggle('is-visible', telemetry.crashed)
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [])

    return (
        <div className="hud is-visible">
            {USE_TRACK && <Minimap />}
            <div className="boost" ref={boost}><i ref={fill} /></div>
            <div className="hud-speed"><b ref={kmh}>0</b><span>km/h</span></div>
            <div className="crash-banner" ref={banner}>CRASHED</div>
            <div className="hint">
                <b>W A S D</b> drive · <b>SPACE</b> drift · <b>SHIFT</b> boost · crash steer = aftertouch · <b>R</b> reset
            </div>
        </div>
    )
}
