import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { SunsetScene } from './SunsetScene.jsx'
import { MAPS } from './maps.js'
import { useKeyboard } from '../game/input.js'
import { drive } from './hudState.js'
import { session } from './session.js'
import { startAudio, toggleMute } from './audio.js'

const km = (m) => `${(m / 1000).toFixed(1)} km`

/**
 * Endless sunset cruise — its own self-contained page. A title screen, the
 * kinematic drive scene, a speed/distance HUD, and steer-only controls.
 */
export function SunsetApp() {
    const [phase, setPhase] = useState('title')
    const [mapIndex, setMapIndex] = useState(0)
    useKeyboard() // global key listeners for steering/camera/paint

    const begin = () => {
        if (session.started) return
        session.started = true
        startAudio()          // must be from a user gesture
        setPhase('driving')
    }

    useEffect(() => {
        const h = (e) => {
            if (e.code === 'KeyM') toggleMute()
            if (phase === 'title' && (e.code === 'Enter' || e.code === 'Space')) begin()
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [phase])

    return (
        <>
            <Canvas
                shadows
                dpr={1}
                gl={{ antialias: false, toneMapping: THREE.NoToneMapping }}
                camera={{ fov: 68, near: 0.1, far: 3200, position: [0, 3.4, -9.5] }}
            >
                <Suspense fallback={null}>
                    <SunsetScene map={MAPS[mapIndex]} />
                </Suspense>
            </Canvas>

            {phase === 'title'
                ? <Title onStart={begin} mapIndex={mapIndex} setMapIndex={setMapIndex} />
                : <Hud />}
            <Loading />
        </>
    )
}

function Title({ onStart, mapIndex, setMapIndex }) {
    return (
        <div className="sunset-title">
            <h1>SUNSET<br />DRIVE</h1>
            <p className="sunset-sub">driving into the sunset</p>
            <div className="sunset-maps">
                {MAPS.map((m, i) => (
                    <button key={m.id} className={`sunset-map${i === mapIndex ? ' is-active' : ''}`}
                        onClick={() => setMapIndex(i)}>{m.name}</button>
                ))}
            </div>
            <button className="sunset-start" onClick={onStart}>PRESS TO DRIVE</button>
            <p className="sunset-controls">
                <b>A</b> <b>D</b> STEER &middot; <b>V</b> CAMERA &middot; <b>C</b> PAINT &middot; <b>M</b> MUTE
            </p>
            {session.best > 0 && <p className="sunset-best-title">BEST {km(session.best)}</p>}
        </div>
    )
}

function Hud() {
    const kmh = useRef(null)
    const cam = useRef(null)
    const paint = useRef(null)
    const dist = useRef(null)
    const best = useRef(null)
    const record = useRef(null)
    const lap = useRef(null)
    useEffect(() => {
        let raf
        const loop = () => {
            if (kmh.current) kmh.current.textContent = drive.kmh
            if (cam.current) cam.current.textContent = drive.cam
            if (paint.current) paint.current.textContent = drive.paint
            if (dist.current) dist.current.textContent = km(session.distance)
            if (best.current) best.current.textContent = km(session.best)
            if (lap.current) lap.current.textContent = drive.lap
            if (record.current) record.current.style.opacity = session.newBest ? '1' : '0'
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <div className="sunset-hud">
            <div className="sunset-dist">
                <b className="sunset-lap">LAP <span ref={lap}>1</span></b>
                <span ref={dist}>0.0 km</span>
                <small>BEST <b ref={best}>0.0 km</b></small>
                <em ref={record}>NEW RECORD</em>
            </div>
            <div className="sunset-cam">CAM <b ref={cam}>CHASE</b> &middot; PAINT <b ref={paint}>BLUE</b></div>
            <div className="sunset-speed"><b ref={kmh}>0</b><span>km/h</span></div>
            <div className="sunset-hint"><b>A</b> <b>D</b> STEER &middot; <b>V</b> CAMERA &middot; <b>C</b> PAINT</div>
        </div>
    )
}

function Loading() {
    const { active, progress } = useProgress()
    if (!active) return null
    return <div className="sunset-loading">Loading… {Math.round(progress)}%</div>
}
