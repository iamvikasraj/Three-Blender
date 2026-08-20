import { CARS } from './constants.js'

/**
 * Car-select HTML overlay — the stat block and picker that sit over the 3D
 * turntable. Navigation state lives in the game store (driven by keyboard in
 * App and the arrow buttons here).
 */
export function GarageOverlay({ carKey, keys, onCycle, onSelect }) {
    const car = CARS[carKey]
    return (
        <div className="garage">
            <div className="garage__bar">
                <div className="garage__title">
                    <div className="garage__hazard" />
                    <div>
                        <h1>Car Select</h1>
                        <p>[ Choose Your Weapon ]</p>
                    </div>
                </div>
                <div className="garage__rank"><span>Your Rank</span><b>Elite</b></div>
            </div>

            <div className="garage__stats">
                <h2>{car.name}</h2>
                <div className="garage__stat"><span>Crashbreaker</span><b>{car.stats?.crashbreaker ?? '—'}</b></div>
                <div className="garage__stat"><span>Weight</span><b>{car.stats?.weight ?? '—'}</b></div>
                <div className="garage__stat"><span>Boost Speed</span><b>{car.stats?.boostMph ? `${car.stats.boostMph} MPH` : '—'}</b></div>
            </div>

            <div className="garage__picker">
                <button className="garage__arrow" onClick={() => onCycle(-1)} aria-label="Previous car">◀</button>
                <div className="garage__names">
                    {keys.map((k) => (
                        <span key={k} className={`garage__name${k === carKey ? ' is-active' : ''}`}>{CARS[k].name}</span>
                    ))}
                </div>
                <button className="garage__arrow" onClick={() => onCycle(1)} aria-label="Next car">▶</button>
            </div>

            <div className="garage__footer">
                <b>A</b> / <b>D</b> or <b>◀ ▶</b> browse · <b>ENTER</b> select
            </div>
        </div>
    )
}
