import { useEffect } from 'react'

/**
 * Global keyboard state. A single module-level record shared by every system
 * that reads input, populated by one pair of window listeners.
 */
export const keys = {}

let listenerCount = 0
const isGameKey = (code) =>
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)

/**
 * Mount the global key listeners for the lifetime of the component.
 * `onPress(code)` fires once per physical keydown (for menu navigation).
 */
export function useKeyboard(onPress) {
    useEffect(() => {
        const down = (e) => {
            if (isGameKey(e.code)) e.preventDefault()
            const wasDown = keys[e.code]
            keys[e.code] = true
            if (!wasDown) onPress?.(e.code)
        }
        const up = (e) => { keys[e.code] = false }
        window.addEventListener('keydown', down)
        window.addEventListener('keyup', up)
        listenerCount++
        return () => {
            window.removeEventListener('keydown', down)
            window.removeEventListener('keyup', up)
            listenerCount--
        }
    }, [onPress])
}

/** Convenience axis reads used by the driving loop. */
export const readThrottle = () => (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0
export const readSteer = () => (keys.KeyA || keys.ArrowLeft) ? 1 : (keys.KeyD || keys.ArrowRight) ? -1 : 0
