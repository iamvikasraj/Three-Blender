/**
 * Run state + the distance high-score. `best` is the furthest you've ever
 * driven, persisted in localStorage; `prevBest` is the target to beat this run.
 */
const KEY = 'sunset-best'
const stored = Number(localStorage.getItem(KEY) || 0)

export const session = {
    started: false,
    distance: 0,          // metres this run
    best: stored,         // best ever (m)
    prevBest: stored,     // best at the start of this run (the bar to beat)
    newBest: false,
    _savedAt: stored,
}

export function bumpDistance(metres) {
    session.distance += metres
    if (session.distance > session.best) {
        session.best = session.distance
        if (session.prevBest > 0) session.newBest = true
        // Persist lazily, once per 100 m, to avoid hammering localStorage.
        if (session.best - session._savedAt > 100) {
            session._savedAt = session.best
            try { localStorage.setItem(KEY, String(Math.floor(session.best))) } catch { /* ignore */ }
        }
    }
}
