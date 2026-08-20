/**
 * All sound is synthesised with the Web Audio API — no asset files. A chill
 * synthwave bed (pad + delayed arp), plus a speed-reactive engine hum and wind.
 * Must be started from a user gesture (the "press to drive" button).
 */
let ctx, master, engineOscs, engineGain, windGain, arpTimer
let started = false, muted = false

export function startAudio() {
    if (started) return
    started = true
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6) // fade in
    master.connect(ctx.destination)

    // ── Engine: two detuned saws through a lowpass ───────────────────────────
    const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 640
    engineGain = ctx.createGain(); engineGain.gain.value = 0.05
    engineOscs = [0, 7].map((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46; o.detune.value = det
        o.connect(eLP); o.start(); return o
    })
    eLP.connect(engineGain); engineGain.connect(master)

    // ── Wind: looping noise through a bandpass ───────────────────────────────
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
    const wBP = ctx.createBiquadFilter(); wBP.type = 'bandpass'; wBP.frequency.value = 850; wBP.Q.value = 0.7
    windGain = ctx.createGain(); windGain.gain.value = 0
    noise.connect(wBP); wBP.connect(windGain); windGain.connect(master); noise.start()

    startMusic()
}

function startMusic() {
    const musicGain = ctx.createGain(); musicGain.gain.value = 0.30; musicGain.connect(master)

    // Pad — an A-minor drone with a slow tremolo.
    const padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.frequency.value = 1100
    const padGain = ctx.createGain(); padGain.gain.value = 0.11
    ;[220, 261.63, 329.63].forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f
        o.connect(padLP); o.start()
    })
    padLP.connect(padGain); padGain.connect(musicGain)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.045
    lfo.connect(lfoG); lfoG.connect(padGain.gain); lfo.start()

    // Arp — square blips with a dotted delay for that synthwave shimmer.
    const delay = ctx.createDelay(); delay.delayTime.value = 0.27
    const fb = ctx.createGain(); fb.gain.value = 0.32
    delay.connect(fb); fb.connect(delay); delay.connect(musicGain)
    const arpBus = ctx.createGain(); arpBus.gain.value = 0.5; arpBus.connect(musicGain)

    const notes = [220, 329.63, 440, 329.63, 261.63, 392, 523.25, 392]
    const beat = 0.26
    let step = 0, next = ctx.currentTime + 0.15
    const schedule = () => {
        while (next < ctx.currentTime + 0.25) {
            const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = notes[step % notes.length]
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, next)
            g.gain.linearRampToValueAtTime(0.16, next + 0.01)
            g.gain.exponentialRampToValueAtTime(0.0008, next + 0.24)
            o.connect(g); g.connect(arpBus); g.connect(delay)
            o.start(next); o.stop(next + 0.26)
            step++; next += beat
        }
    }
    arpTimer = setInterval(schedule, 60)
}

/** Feed the drive loop: 0..1 speed, plus boost flag. */
export function updateAudio(speed01, boosting = false) {
    if (!started) return
    const t = ctx.currentTime
    const hz = 46 + speed01 * 130 + (boosting ? 40 : 0)
    engineOscs.forEach((o) => o.frequency.setTargetAtTime(hz, t, 0.06))
    engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.10, t, 0.1)
    windGain.gain.setTargetAtTime(speed01 * 0.11, t, 0.1)
}

export function toggleMute() {
    muted = !muted
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.12)
    return muted
}
