import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { SunsetScene } from './SunsetScene.jsx'
import { useKeyboard } from '../game/input.js'
import { drive } from './hudState.js'
import { session } from './session.js'
import { musicState, setMusicVolume, setSfxVolume, startAudio, toggleMute } from './audio.js'
import { lyricWordsAt } from './lyrics.js'
import { net, connect, ensureRoom, onRoster, rivalCount } from './net.js'

const km = (m) => `${(m / 1000).toFixed(1)} km`
const NAME = 'RACER ' + Math.random().toString(36).slice(2, 5).toUpperCase()

const VISITORS_KEY = 'sunset:visitors'

function bumpVisitors() {
    try {
        const value = Number(localStorage.getItem(VISITORS_KEY) || '0') + 1
        localStorage.setItem(VISITORS_KEY, String(value))
        return value
    } catch {
        return 0
    }
}

function readVisitors() {
    try {
        return Number(localStorage.getItem(VISITORS_KEY) || '0')
    } catch {
        return 0
    }
}

// ── "Last played" — who drove most recently, and from where ─────────────────
// Country is derived from the browser locale (no network geo-IP). Stored per
// device in localStorage; a shared/global list would live on the party server.
const LAST_KEY = 'sunset:lastplay'
function localPlace() {
    const loc = (navigator.languages && navigator.languages[0]) || navigator.language || ''
    const parts = loc.split('-')
    let code = parts.length > 1 ? parts[parts.length - 1] : ''
    if (!/^[A-Za-z]{2}$/.test(code)) return { flag: '🌐', country: 'Somewhere' }
    code = code.toUpperCase()
    const flag = code.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    let country = code
    try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code } catch {}
    return { flag, country }
}
function saveLastPlay() {
    try {
        const raw = JSON.parse(localStorage.getItem(LAST_KEY) || '[]')
        const list = Array.isArray(raw) ? raw : raw ? [raw] : []
        const item = { name: NAME, ...localPlace(), t: Date.now() }
        const next = [item, ...list.filter(Boolean)].slice(0, 5)
        localStorage.setItem(LAST_KEY, JSON.stringify(next))
    } catch {}
}
function timeAgo(t) {
    const s = Math.max(0, (Date.now() - t) / 1000)
    if (s < 60) return 'just now'
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}
function readLastPlay() {
    try {
        const d = JSON.parse(localStorage.getItem(LAST_KEY) || '[]')
        const list = Array.isArray(d) ? d : d ? [d] : []
        return list.map((entry) => ({
            name: entry.name || 'RACER',
            flag: entry.flag || '🌐',
            country: entry.country || 'Somewhere',
            ago: timeAgo(entry.t || Date.now())
        })).slice(0, 5)
    } catch { return [] }
}

/**
 * Sunset Boulevard — endless multiplayer cruise. Connects to a PartyKit room on
 * load, shows a lobby on
 * the title screen, then a HUD with speed, boost and the rival gap.
 */
export function SunsetApp() {
    const [phase, setPhase] = useState('title')
    const [fade, setFade] = useState(false)
    useKeyboard()

    // Single-player mode for now: no room connection or rival roster.
    useEffect(() => {
        net.name = NAME
        net.room = 'solo'
        bumpVisitors()
    }, [])

    const begin = () => {
        if (session.started) return
        session.started = true
        saveLastPlay()
        setFade(false)
        startAudio(() => {
            // Song ended: the car has driven off into the dark. Show the menu
            // behind the black veil, then lift the veil to reveal it.
            session.started = false
            setPhase('title')
            setTimeout(() => setFade(false), 700)
        })
        setPhase('driving')
    }

    // Outro: once the track is nearly over, sink the screen to black while the
    // car races into the sunset.
    useEffect(() => {
        if (phase !== 'driving') return
        let raf
        const watch = () => {
            if (musicState.progress > 0.965) setFade(true)
            raf = requestAnimationFrame(watch)
        }
        raf = requestAnimationFrame(watch)
        return () => cancelAnimationFrame(raf)
    }, [phase])

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
            <div className="sunset-stage">
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
            </div>

            <div className="sunset-letterbox sunset-letterbox--top" aria-hidden="true" />
            <div className="sunset-letterbox sunset-letterbox--bottom" aria-hidden="true" />

            <div className="sunset-ui-stage">
                {phase === 'title' ? <Title onStart={begin} /> : <Hud />}
                {phase === 'driving' && <Captions />}
            </div>
            <div className={`sunset-fade ${fade ? 'is-black' : ''}`} />
            <Loading />
        </>
    )
}

function Title({ onStart }) {
    const rivals = 0
    const visitors = readVisitors()
    const recentRuns = readLastPlay()

    return (
        <div className="sunset-title">
            <h1>SUNSET<br />BOULEVARD</h1>
            <p className="sunset-sub">driving into the sunset</p>

            <div className="sunset-lobby">
                <span className={rivals ? 'is-ready' : ''}>
                    {rivals ? `RIVAL CONNECTED (${rivals})` : ''}
                </span>
            </div>

            <button className="sunset-start" onClick={onStart}>READY TO DRIVE</button>
            <p className="sunset-controls">
                <b>W</b> ACCELERATE &middot; <b>A</b> <b>D</b> STEER &middot; <b>SHIFT</b> BOOST &middot; <b>V</b> CAM &middot; <b>M</b> MUTE
            </p>
        </div>
    )
}

function Hud() {
    const cam = useRef(null)
    const gap = useRef(null)
    const boost = useRef(null)
    const boostFill = useRef(null)
    const speed = useRef(null)
    const lap = useRef(null)
    const [tool, setTool] = useState(null) // 'audio' | 'controls' | null
    const toggle = (name) => setTool((t) => (t === name ? null : name))
    useEffect(() => {
        let raf
        const loop = () => {
            if (cam.current) cam.current.textContent = drive.cam
            if (gap.current) {
                if (drive.gap == null) gap.current.textContent = ''
                else if (drive.gap >= 0) gap.current.textContent = `RIVAL AHEAD ${drive.gap} m`
                else gap.current.textContent = `RIVAL BEHIND ${-drive.gap} m`
            }
            if (boost.current) boost.current.textContent = `${Math.round(drive.boost * 100)}%`
            if (boostFill.current) boostFill.current.style.width = `${Math.max(0, Math.min(100, drive.boost * 100))}%`
            if (speed.current) speed.current.textContent = drive.kmh
            if (lap.current) lap.current.textContent = `LAP ${drive.lap}`
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <div className="sunset-hud">
            <div className="sunset-gap" ref={gap} />
            <div className="sunset-brand" aria-label="Sunset Boulevard" title="Sunset Boulevard">
                SUNSET BOULEVARD
            </div>
            <div className="sunset-lap" ref={lap}>LAP 1</div>
            <div className="sunset-dash" aria-live="polite">
                <div className="sunset-dash__speed">
                    <span className="sunset-dash__kmh" ref={speed}>0</span>
                    <span className="sunset-dash__unit">KM/H</span>
                </div>
                <div className="sunset-dash__boost">
                    <span className="sunset-boost__label">BOOST</span>
                    <div className="sunset-boost__bar">
                        <div className="sunset-boost__fill" ref={boostFill} />
                    </div>
                    <span className="sunset-boost__value" ref={boost}>100%</span>
                </div>
            </div>

            <div className="sunset-tools" onMouseLeave={() => setTool(null)}>
                <div className="sunset-tools__bar">
                    <div className="sunset-cam">CAM <b ref={cam}>CHASE</b></div>
                    <button className={`sunset-tools__btn ${tool === 'audio' ? 'is-active' : ''}`}
                        onMouseEnter={() => setTool('audio')} onClick={() => toggle('audio')}
                        aria-label="Audio mix" aria-expanded={tool === 'audio'}>
                        <IconSound />
                    </button>
                    <button className={`sunset-tools__btn ${tool === 'controls' ? 'is-active' : ''}`}
                        onMouseEnter={() => setTool('controls')} onClick={() => toggle('controls')}
                        aria-label="Controls" aria-expanded={tool === 'controls'}>
                        <IconPad />
                    </button>
                </div>
                {tool === 'audio' && <div className="sunset-tools__panel"><AudioMixer /></div>}
                {tool === 'controls' && (
                    <div className="sunset-tools__panel">
                        <ul className="sunset-keys">
                            <li><span className="sunset-keys__k"><b>A</b><b>D</b></span> STEER</li>
                            <li><span className="sunset-keys__k"><b>SHIFT</b></span> BOOST</li>
                            <li><span className="sunset-keys__k"><b>V</b></span> CAM</li>
                            <li><span className="sunset-keys__k"><b>M</b></span> MUTE</li>
                        </ul>
                    </div>
                )}
            </div>
        </div>
    )
}

// Chunky pixel-block icons (Press Start retro). Filled shapes on an integer
// grid, crisp-edge rasterised so they read as pixel art.
function IconSound() {
    return (
        <svg viewBox="0 0 18 16" width="24" height="21" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
            {/* stepped speaker cone */}
            <path d="M2 6 H4 V10 H2 Z M4 6 H5 V5 H6 V4 H7 V3 H8 V13 H7 V12 H6 V11 H5 V10 H4 Z" />
            {/* blocky sound waves */}
            <rect x="10" y="6" width="2" height="4" />
            <rect x="13" y="4" width="2" height="8" />
        </svg>
    )
}

function IconPad() {
    return (
        <svg viewBox="0 0 22 16" width="26" height="19" fill="currentColor" fillRule="evenodd" shapeRendering="crispEdges" aria-hidden="true">
            {/* body silhouette with two grip legs, D-pad + buttons punched out */}
            <path d="M3 5 H19 V11 H16 V13 H13 V11 H9 V13 H6 V11 H3 Z
                     M7 6 H8 V7 H9 V8 H8 V9 H7 V8 H6 V7 H7 Z
                     M13 7 H15 V9 H13 Z M16 8 H18 V10 H16 Z" />
        </svg>
    )
}

function IconCassette() {
    return (
        <svg viewBox="0 0 32 22" width="40" height="28" shapeRendering="crispEdges" aria-hidden="true">
            <path d="M4 1 H28 V3 H30 V19 H28 V21 H4 V19 H2 V3 H4 Z" fill="#d5e2d0" />
            <path d="M5 3 H27 V5 H28 V17 H26 V19 H6 V17 H4 V5 H5 Z" fill="#23483c" />
            <path d="M8 5 H24 V12 H8 Z" fill="#e9b46d" />
            <path d="M10 7 H14 V11 H10 Z M18 7 H22 V11 H18 Z" fill="#17372d" />
            <path d="M11 8 H13 V10 H11 Z M19 8 H21 V10 H19 Z" fill="#d5e2d0" />
            <path d="M12 14 H20 V16 H12 Z M10 16 H22 V17 H10 Z" fill="#d5e2d0" />
        </svg>
    )
}

/**
 * Centre-screen captions synced to the song time. Reads the active cue from
 * lyrics.js each frame and cross-fades when the line changes. Text is driven
 * imperatively (no re-render per frame).
 */
function Captions() {
    const el = useRef(null)
    useEffect(() => {
        let raf
        let shown = null
        const loop = () => {
            const active = lyricWordsAt(musicState.time)
            const line = active?.cue.text || ''
            if (line !== shown) {
                shown = line
                const node = el.current
                if (node) {
                    node.classList.remove('is-visible')
                    // Swap text on the next frame so the fade-out reads before fade-in.
                    requestAnimationFrame(() => {
                        node.replaceChildren(...(active?.cue.words || []).map((word) => {
                            const span = document.createElement('span')
                            span.textContent = word.text
                            return span
                        }))
                        if (line) node.classList.add('is-visible')
                    })
                }
            }
            if (el.current) {
                for (const [index, word] of [...el.current.children].entries()) {
                    word.classList.toggle('is-sung', index <= (active?.wordIndex ?? -1))
                }
            }
            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [])
    return <div className="sunset-caption" ref={el} aria-live="polite" />
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
