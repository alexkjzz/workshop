// Deterministic simulated scene: every value is a function of time, so the
// backfilled history and the live stream join without a break.

const PRESENCE_PERIOD_S = 60;
const PRESENCE_DURATION_S = 20;

function noise(t: number, seed: number) {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

// Someone crosses the zone for 20 s every minute; progress goes from 0 to 1.
export function presenceAt(t: number): number | null {
  const phase = t % PRESENCE_PERIOD_S;
  return phase < PRESENCE_DURATION_S ? phase / PRESENCE_DURATION_S : null;
}

// Every other visitor is unknown to the face recognition.
export function visitorAt(t: number): string | null {
  return Math.floor(t / PRESENCE_PERIOD_S) % 2 === 0 ? 'Operateur' : null;
}

export function telemetryAt(t: number) {
  const temperature = 22 + 1.5 * Math.sin((2 * Math.PI * t) / 600) + noise(t, 1) * 0.3;
  const humidity = 48 - 4 * Math.sin((2 * Math.PI * t) / 600) + noise(t, 2) * 1.5;
  // Slow gas drift with a bump every 4 minutes, as for a small leak.
  const bump = Math.max(0, Math.sin((2 * Math.PI * t) / 240)) ** 8;
  const gas = 150 + 140 * bump + noise(t, 3) * 12;
  return {
    temperature: Math.round(temperature * 10) / 10,
    humidity: Math.round(humidity),
    gas: Math.round(gas),
    presence: presenceAt(t) !== null,
  };
}
