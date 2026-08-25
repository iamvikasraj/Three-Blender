import lrc from '../game/in-the-air-tonight.lrc?raw'

/**
 * Centre-screen captions, driven by an .lrc lyric file that ships as a project
 * asset. The lyric text is NOT stored in source — it's parsed at runtime from
 * `in-the-air-tonight.lrc` (which carries its own [ar:]/[ti:]/[al:] credits).
 *
 * Swap in a different track by replacing the .lrc import above; the format is
 * the standard `[mm:ss.xx]line of text` used by most lyric files.
 */

/** Parse `[mm:ss.xx]text` lines into time-ordered { t, text } cues. */
function parseLrc(text) {
    const cues = []
    for (const raw of text.split(/\r?\n/)) {
        const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
        if (!m) continue // skips metadata tags like [ar:], [ti:], [length:]
        const t = Number(m[1]) * 60 + Number(m[2])
        // Strip inline word-level timing tags like <01:02.79> and tidy spacing.
        const text = m[3].replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim()
        cues.push({ t, text }) // empty text = a natural caption clear
    }
    cues.sort((a, b) => a.t - b.t)
    return cues
}

export const LYRICS = parseLrc(lrc)

/**
 * The active caption for a given playback time (seconds). Each line holds until
 * the next cue, but drops a couple of seconds early so it fades out before the
 * next one arrives (and instrumental gaps come through as blank cues).
 */
const TAIL = 2    // seconds a held line lingers before the next cue
const LEAD = 0.4  // seconds to fire each cue early, so its fade-in lands on the beat
export function lyricAt(time) {
    const t = time + LEAD
    let active = ''
    for (let i = 0; i < LYRICS.length; i++) {
        const cue = LYRICS[i]
        if (t < cue.t) break
        const next = LYRICS[i + 1]?.t ?? Infinity
        const end = Number.isFinite(next) ? next - TAIL : Infinity
        active = t < end ? cue.text : ''
    }
    return active
}
