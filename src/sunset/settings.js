// ── Steering Sensitivity Settings ─────────────────────────────────────────────
// Player-configurable steering response. 0.5 = half responsive, 2.0 = double.
// Stored in localStorage.

const SETTINGS_KEY = 'sunset:settings'
const DEFAULT_STEERING_SENSITIVITY = 1.0

export const settings = {
    steeringSensitivity: DEFAULT_STEERING_SENSITIVITY
}

export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY)
        if (saved) {
            const data = JSON.parse(saved)
            settings.steeringSensitivity = data.steeringSensitivity ?? DEFAULT_STEERING_SENSITIVITY
        }
    } catch (e) {
        console.warn('Failed to load settings:', e)
    }
}

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch (e) {
        console.warn('Failed to save settings:', e)
    }
}

export function setSteeringSensitivity(value) {
    settings.steeringSensitivity = Math.max(0.3, Math.min(2.0, value)) // Clamp 0.3–2.0
    saveSettings()
}
