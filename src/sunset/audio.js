import musicUrl from '../game/Phil_Collins_-_In_The_Air_Tonight_Original_(mp3.pm).mp3'

/**
 * The drive uses a looping local soundtrack, plus a speed-reactive engine hum
 * and wind ambience. Playback starts from the user's drive interaction.
 * Must be started from a user gesture (the "press to drive" button).
 */
let ctx, master, sfxBus, engineOscs, engineGain, windGain, music, musicAnalyser, musicSource
let started = false, muted = false, onMusicEnded = null
let musicLevel = 0.8
let sfxLevel = 0.4
export const musicState = { progress: 0 }

export function startAudio(onEnded) {
    onMusicEnded = onEnded || onMusicEnded
    if (started) {
        if (music?.ended) {
            music.currentTime = 0
            musicState.progress = 0
            music.play().catch(() => {})
        }
        return
    }
    started = true
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0
    master.gain.setTargetAtTime(0.65, ctx.currentTime, 0.6) // fade in
    master.connect(ctx.destination)

    sfxBus = ctx.createGain()
    sfxBus.gain.value = sfxLevel
    sfxBus.connect(master)

    music = new Audio(musicUrl)
    music.loop = false
    music.volume = musicLevel
    musicSource = ctx.createMediaElementSource(music)
    musicAnalyser = ctx.createAnalyser()
    musicAnalyser.fftSize = 256
    musicSource.connect(musicAnalyser)
    musicAnalyser.connect(master)
    music.addEventListener('timeupdate', () => {
        musicState.progress = music.duration ? music.currentTime / music.duration : 0
    })
    music.addEventListener('ended', () => {
        musicState.progress = 1
        onMusicEnded?.()
    })
    music.play().catch(() => {})

    // ── Engine: muted cabin rumble through a dark lowpass ────────────────────
    const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 360; eLP.Q.value = 0.7
    engineGain = ctx.createGain(); engineGain.gain.value = 0.018
    engineOscs = [0, 7].map((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46; o.detune.value = det
        o.connect(eLP); o.start(); return o
    })
    eLP.connect(engineGain); engineGain.connect(sfxBus)

    // ── Wind: looping noise through a bandpass ───────────────────────────────
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
    const wBP = ctx.createBiquadFilter(); wBP.type = 'bandpass'; wBP.frequency.value = 620; wBP.Q.value = 0.55
    windGain = ctx.createGain(); windGain.gain.value = 0
    noise.connect(wBP); wBP.connect(windGain); windGain.connect(sfxBus); noise.start()

}

export function setMusicVolume(value) {
    musicLevel = Math.max(0, Math.min(1, Number(value)))
    if (music) music.volume = musicLevel
}

export function setSfxVolume(value) {
    sfxLevel = Math.max(0, Math.min(1, Number(value)))
    if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(sfxLevel, ctx.currentTime, 0.06)
}

export function getMusicEnergy() {
    if (!musicAnalyser) return 0
    const samples = new Uint8Array(musicAnalyser.frequencyBinCount)
    musicAnalyser.getByteFrequencyData(samples)
    let total = 0
    for (const sample of samples) total += sample
    return total / (samples.length * 255)
}

/** Feed the drive loop: 0..1 speed, plus boost flag. */
export function updateAudio(speed01, boosting = false) {
    if (!started) return
    if (music?.duration) musicState.progress = music.currentTime / music.duration
    const t = ctx.currentTime
    const hz = 46 + speed01 * 130 + (boosting ? 40 : 0)
    engineOscs.forEach((o) => o.frequency.setTargetAtTime(hz, t, 0.06))
    engineGain.gain.setTargetAtTime(0.012 + speed01 * 0.035, t, 0.14)
    windGain.gain.setTargetAtTime(speed01 * 0.04, t, 0.14)
}

export function toggleMute() {
    muted = !muted
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.65, ctx.currentTime, 0.12)
    if (music) music.muted = muted
    return muted
}
