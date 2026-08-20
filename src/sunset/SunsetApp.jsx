import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { SunsetScene } from './SunsetScene.jsx'
import { useKeyboard } from '../game/input.js'
import { drive } from './hudState.js'
import { session } from './session.js'
import { startAudio, toggleMute } from './audio.js'
import { net, connect, ensureRoom, onRoster, rivalCount } from './net.js'

const km = (m) => `${(m / 1000).toFixed(1)} km`
const NAME = 'RACER ' + Math.random().toString(36).slice(2, 5).toUpperCase()

/**
 * Sunset Boulevard — endless multiplayer cruise. Connects to a PartyKit room on
 * load (room code lives in the URL, so the link is shareable), shows a lobby on
 * the title screen, then a HUD with speed, boost and the rival gap.
 */
export function SunsetApp() {
    const [phase, setPhase] = useState('title')
    useKeyboard()

    // Join the room straight away so the lobby shows who's here.
    useEffect(() => {
        net.name = NAME
        connect(ensureRoom())
    }, [])

    const begin = () => {
        if (session.started) return
        session.started = true
        startAudio()
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
                    <SunsetScene />
                </Suspense>
            </Canvas>

            {phase === 'title' ? <Title onStart={begin} /> : <Hud />}
            <Loading />
        </>
    )
}

function Title({ onStart }) {
    const [rivals, setRivals] = useState(0)
    const [copied, setCopied] = useState(false)
    useEffect(() => onRoster(() => setRivals(rivalCount())), [])

    const share = () => {
        navigator.clipboard?.writeText(window.location.href)
        setCopied(true); setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className="sunset-title">
            <h1>SUNSET<br />BOULEVARD</h1>
            <p className="sunset-sub">driving into the sunset</p>

            <div className="sunset-lobby">
                <span>ROOM <b>{net.room}</b></span>
                <button className="sunset-share" onClick={share}>{copied ? 'LINK COPIED' : 'SHARE LINK'}</button>
                <span className={rivals ? 'is-ready' : ''}>
                    {rivals ? `RIVAL CONNECTED (${rivals})` : 'WAITING FOR RIVAL…'}
                </span>
            </div>

            <button className="sunset-start" onClick={onStart}>PRESS TO DRIVE</button>
            <p className="sunset-controls">
                <b>A</b> <b>D</b> STEER &middot; <b>SHIFT</b> BOOST &middot; <b>V</b> CAM &middot; <b>C</b> PAINT &middot; <b>M</b> MUTE
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
    const boost = useRef(null)
    const gap = useRef(null)
    useEffect(() => {
        let raf
        const loop = () => {
            if (kmh.current) kmh.current.textContent = drive.kmh
            if (cam.current) cam.current.textContent = drive.cam
            if (paint.current) paint.current.textContent = drive.paint
            if (dist.current) dist.current.textContent = km(session.distance)
            if (best.current) best.current.textContent = km(session.best)
            if (record.current) record.current.style.opacity = session.newBest ? '1' : '0'
            if (boost.current) boost.current.style.transform = `scaleX(${drive.boost})`
            if (gap.current) {
                if (drive.gap == null) gap.current.textContent = ''
                else if (drive.gap >= 0) gap.current.textContent = `RIVAL AHEAD ${drive.gap} m`
                else gap.current.textContent = `RIVAL BEHIND ${-drive.gap} m`
            }
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <div className="sunset-hud">
            <div className="sunset-dist">
                <span ref={dist}>0.0 km</span>
                <small>BEST <b ref={best}>0.0 km</b></small>
                <em ref={record}>NEW RECORD</em>
            </div>
            <div className="sunset-gap" ref={gap} />
            <div className="sunset-cam">CAM <b ref={cam}>CHASE</b> &middot; PAINT <b ref={paint}>BLUE</b></div>
            <div className="sunset-boost"><i ref={boost} /></div>
            <div className="sunset-speed"><b ref={kmh}>0</b><span>km/h</span></div>
            <div className="sunset-hint"><b>A</b> <b>D</b> STEER &middot; <b>SHIFT</b> BOOST &middot; <b>V</b> CAM &middot; <b>C</b> PAINT</div>
        </div>
    )
}

function Loading() {
    const { active, progress } = useProgress()
    if (!active) return null
    return <div className="sunset-loading">Loading… {Math.round(progress)}%</div>
}
