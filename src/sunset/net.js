import { PartySocket } from 'partysocket'

/**
 * Multiplayer client. Connects to a PartyKit room, streams our car state, and
 * keeps every other player's latest state in `net.players` (a mutable map read
 * by the render loop — no React churn). `onRoster` fires only when players
 * join/leave, so React can track the list of ghosts to render.
 *
 * Dev talks to `partykit dev` on localhost:1999; set VITE_PARTYKIT_HOST to the
 * deployed host (e.g. sunset-boulevard.<you>.partykit.dev) for real play.
 */
const HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

export const net = {
    id: null,
    room: null,
    name: 'RACER',
    connected: false,
    players: {},        // id -> { id, name, dist, x, hue, kmh, boosting }
}

let socket = null
const listeners = new Set()

/** Subscribe to join/leave changes; returns an unsubscribe fn. */
export function onRoster(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function roster() { listeners.forEach((fn) => fn()) }

/** Number of OTHER players currently in the room. */
export function rivalCount() { return Object.keys(net.players).filter((id) => id !== net.id).length }

export function connect(room) {
    if (socket) return
    net.room = room
    socket = new PartySocket({ host: HOST, room })

    socket.addEventListener('open', () => { net.connected = true })
    socket.addEventListener('close', () => { net.connected = false })
    socket.addEventListener('message', (e) => {
        let msg
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.type === 'welcome') {
            net.id = msg.id
            for (const p of msg.players) net.players[p.id] = p
            roster()
        } else if (msg.type === 'state') {
            const isNew = !net.players[msg.player.id]
            net.players[msg.player.id] = msg.player
            if (isNew) roster()
        } else if (msg.type === 'leave') {
            if (net.players[msg.id]) { delete net.players[msg.id]; roster() }
        }
    })
}

export function sendState(player) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'state', player }))
}

export function disconnect() {
    socket?.close()
    socket = null
    net.connected = false
    net.players = {}
    net.id = null
}

/** Room id from ?room=… , or a fresh short code (also written back to the URL). */
export function ensureRoom() {
    const url = new URL(window.location.href)
    let room = url.searchParams.get('room')
    if (!room) {
        room = Math.random().toString(36).slice(2, 8)
        url.searchParams.set('room', room)
        window.history.replaceState(null, '', url)
    }
    return room
}
