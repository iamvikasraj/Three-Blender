import { PartySocket } from 'partysocket'

const MULTIPLAYER_ENABLED = false

/**
 * Local single-player fallback. The sunset prototype is intentionally running
 * without a multiplayer room for now, so all room connectivity is disabled and
 * the UI keeps working in a self-contained mode.
 */
const HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

export const net = {
    id: null,
    room: 'solo',
    name: 'RACER',
    connected: false,
    players: {},        // id -> { id, name, dist, x, hue, kmh, boosting }
}

let socket = null
const listeners = new Set()

/** Subscribe to join/leave changes; returns an unsubscribe fn. */
export function onRoster(fn) {
    if (!MULTIPLAYER_ENABLED) return () => {}
    listeners.add(fn)
    return () => listeners.delete(fn)
}
function roster() { listeners.forEach((fn) => fn()) }

/** Number of OTHER players currently in the room. */
export function rivalCount() { return 0 }

export function connect(room) {
    if (!MULTIPLAYER_ENABLED) {
        net.room = room || 'solo'
        net.connected = false
        net.players = {}
        net.id = null
        return
    }
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
    if (!MULTIPLAYER_ENABLED) return
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'state', player }))
}

export function disconnect() {
    if (!MULTIPLAYER_ENABLED) {
        net.connected = false
        net.players = {}
        net.id = null
        return
    }
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
        room = 'solo'
        url.searchParams.set('room', room)
        window.history.replaceState(null, '', url)
    }
    return room
}
