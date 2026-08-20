/**
 * Sunset Boulevard multiplayer room.
 *
 * Each race is its own room (party). The server is a thin relay + roster: it
 * keeps every connected player's latest state and rebroadcasts updates, so all
 * clients can render each other's cars. No authoritative sim — each client owns
 * its own car (fine for a friendly ghost race).
 */
export default class SunsetRoom {
    constructor(party) {
        this.party = party
        this.players = new Map() // id -> latest state
    }

    onConnect(conn) {
        // Hand the newcomer the current roster + their own id.
        conn.send(JSON.stringify({
            type: 'welcome',
            id: conn.id,
            players: Array.from(this.players.values()),
        }))
    }

    onMessage(message, sender) {
        let data
        try { data = JSON.parse(message) } catch { return }
        if (data.type !== 'state') return

        const player = { id: sender.id, ...data.player }
        this.players.set(sender.id, player)
        // Relay to everyone except the sender.
        this.party.broadcast(JSON.stringify({ type: 'state', player }), [sender.id])
    }

    onClose(conn) {
        this.players.delete(conn.id)
        this.party.broadcast(JSON.stringify({ type: 'leave', id: conn.id }))
    }
}
