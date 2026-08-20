import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { SunsetScene } from './SunsetScene.jsx'
import { useKeyboard } from '../game/input.js'
import { drive } from './hudState.js'
import { session } from './session.js'
import { getMusicEnergy, setMusicVolume, setSfxVolume, startAudio, toggleMute } from './audio.js'
import { net, connect, ensureRoom, onRoster, rivalCount } from './net.js'

const km = (m) => `${(m / 1000).toFixed(1)} km`
const NAME = 'RACER ' + Math.random().toString(36).slice(2, 5).toUpperCase()

/**
 * Sunset Boulevard — endless multiplayer cruise. Connects to a PartyKit room on
 * load, shows a lobby on
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
        startAudio(() => {
            session.started = false
            setPhase('title')
        })
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
    useEffect(() => onRoster(() => setRivals(rivalCount())), [])

    return (
        <div className="sunset-title">
            <h1>SUNSET<br />BOULEVARD</h1>
            <p className="sunset-sub">driving into the sunset</p>

            <div className="sunset-lobby">
                <span>ROOM <b>{net.room}</b></span>
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
    const cam = useRef(null)
    const paint = useRef(null)
    const dist = useRef(null)
    const best = useRef(null)
    const record = useRef(null)
    const gap = useRef(null)
    useEffect(() => {
        let raf
        const loop = () => {
            if (cam.current) cam.current.textContent = drive.cam
            if (paint.current) paint.current.textContent = drive.paint
            if (dist.current) dist.current.textContent = km(session.distance)
            if (best.current) best.current.textContent = km(session.best)
            if (record.current) record.current.style.opacity = session.newBest ? '1' : '0'
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
            <div className="sunset-hint"><b>A</b> <b>D</b> STEER &middot; <b>SHIFT</b> BOOST &middot; <b>V</b> CAM &middot; <b>C</b> PAINT</div>
            <AudioMixer />
            <Equalizer />
        </div>
    )
}

function Equalizer() {
    const bars = useRef([])
    useEffect(() => {
        let raf
        const update = () => {
            const energy = getMusicEnergy()
            bars.current.forEach((bar, index) => {
                if (!bar) return
                const wave = 0.52 + Math.sin(performance.now() * 0.006 + index * 0.42) * 0.42
                const pulse = 0.72 + Math.sin(performance.now() * 0.002 + index * 0.18) * 0.28
                const height = Math.max(5, Math.min(100, (energy * 260 + wave * 24) * pulse))
                bar.style.height = `${height}%`
            })
            raf = requestAnimationFrame(update)
        }
        raf = requestAnimationFrame(update)
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <div className="sunset-equalizer" aria-label="Music equalizer">
            <div className="sunset-equalizer__bars">
                {Array.from({ length: 48 }, (_, index) => index).map((index) => (
                    <i key={index} ref={(bar) => { bars.current[index] = bar }} style={{ height: '5%' }} />
                ))}
            </div>
        </div>
    )
}

function AudioMixer() {
    const [music, setMusic] = useState(80)
    const [sfx, setSfx] = useState(40)
    return (
        <div className="sunset-mixer">
            <div className="sunset-mixer__title">AUDIO MIX</div>
            <label>MUSIC <input type="range" min="0" max="100" value={music} onChange={(event) => { const value = Number(event.target.value); setMusic(value); setMusicVolume(value / 100) }} /></label>
            <label>SFX <input type="range" min="0" max="100" value={sfx} onChange={(event) => { const value = Number(event.target.value); setSfx(value); setSfxVolume(value / 100) }} /></label>
        </div>
    )
}

function Loading() {
    const { active, progress } = useProgress()
    if (!active) return null
    return <div className="sunset-loading">Loading… {Math.round(progress)}%</div>
}
