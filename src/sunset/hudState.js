/** Per-frame bridge from the drive loop to the HUD (read via rAF, no re-renders). */
export const drive = { kmh: 0, cam: 'CHASE', boost: 1, gap: null, flight: false, s: 0, lap: 1, crashes: 0, nearMisses: 0, distance: 0, time: 0, nearMissBoostActive: 0, bestScore: 0 }

/** Best score tracking in localStorage */
const BEST_SCORE_KEY = 'sunset:bestScore'

export function getBestScore() {
    try {
        return Number(localStorage.getItem(BEST_SCORE_KEY) || '0')
    } catch {
        return 0
    }
}

export function updateBestScore(score) {
    try {
        const current = getBestScore()
        if (score > current) {
            localStorage.setItem(BEST_SCORE_KEY, String(Math.round(score * 10) / 10))
            return true
        }
    } catch {}
    return false
}
