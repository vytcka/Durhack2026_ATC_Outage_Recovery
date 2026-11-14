export const SPEED_STEPS = [1, 2, 4, 10];

// Pause/resume button plus a stepped slider for the simulation speed.
// The slider moves over step indexes (0..3), which map onto SPEED_STEPS.
export default function SimulationControls({ multiplier, paused, onMultiplierChange, onTogglePause }) {
  const stepIndex = Math.max(0, SPEED_STEPS.indexOf(multiplier));

  return (
    <div className="panel sim-controls">
      <button
        className="play-pause"
        onClick={onTogglePause}
        aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
      >
        <img src={paused ? '/play.svg' : '/pause.svg'} alt="" />
      </button>

      <div className="speed-slider">
        <input
          type="range"
          min={0}
          max={SPEED_STEPS.length - 1}
          step={1}
          value={stepIndex}
          onChange={(event) => onMultiplierChange(SPEED_STEPS[Number(event.target.value)])}
          aria-label="Simulation speed"
          aria-valuetext={`${multiplier} times`}
        />
        <div className="speed-labels">
          {SPEED_STEPS.map((step) => (
            <button
              key={step}
              className={step === multiplier ? 'active' : undefined}
              onClick={() => onMultiplierChange(step)}
            >
              ×{step}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
