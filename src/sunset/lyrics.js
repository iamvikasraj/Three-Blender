import lrc from '../game/in-the-air-tonight.lrc?raw'

/**
 * Centre-screen captions, driven by an .lrc lyric file that ships as a project
 * asset. The lyric text is NOT stored in source — it's parsed at runtime from
 * `in-the-air-tonight.lrc` (which carries its own [ar:]/[ti:]/[al:] credits).
 *
 * Swap in a different track by replacing the .lrc import above; the format is
 * the standard `[mm:ss.xx]line of text` used by most lyric files.
 */

/** Parse `[mm:ss.xx]text` lines into time-ordered cues with word timestamps. */
function parseLrc(text) {
    const cues = []
    for (const raw of text.split(/\r?\n/)) {
        const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
        if (!m) continue // skips metadata tags like [ar:], [ti:], [length:]
        const t = Number(m[1]) * 60 + Number(m[2])
        const words = []
        const body = m[3]
        const tag = /<(\d+):(\d+(?:\.\d+)?)>/g
        let cursor = 0
        let wordTime = t
        let match
        while ((match = tag.exec(body))) {
            const word = body.slice(cursor, match.index).trim()
            if (word) words.push({ t: wordTime, text: word })
            wordTime = Number(match[1]) * 60 + Number(match[2])
            cursor = tag.lastIndex
        }
        const lastWord = body.slice(cursor).trim()
        if (lastWord) words.push({ t: wordTime, text: lastWord })
        cues.push({ t, text: words.map((word) => word.text).join(' '), words })
    }
    cues.sort((a, b) => a.t - b.t)
    return cues
}

export const LYRICS = parseLrc(lrc)

/**
 * The active caption for a given playback time (seconds). Each line holds until
 * the next cue; explicit blank cues create instrumental gaps.
 */
const LEAD = 0.8   // seconds to fire each cue early, so its fade-in lands on the beat
export function lyricAt(time) {
    return lyricWordsAt(time)?.cue.text || ''
}

export function lyricWordsAt(time) {
    const t = time + LEAD
    let active = null
    for (let i = 0; i < LYRICS.length; i++) {
        const cue = LYRICS[i]
        if (t < cue.t) break
        const next = LYRICS[i + 1]?.t ?? Infinity
        const end = next
        if (t < end && cue.text) {
            let wordIndex = -1
            for (let word = 0; word < cue.words.length; word++) {
                if (t >= cue.words[word].t) wordIndex = word
                else break
            }
            active = { cue, wordIndex }
        }
    }
    return active
}
