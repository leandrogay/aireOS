// Pure timing for the refresh arrow (components/ui/RefreshButton); the
// reasons are with REFRESH_SPIN in app/config/transitions.js.

/**
 * Milliseconds the arrow should keep spinning once the reload is done, so it
 * stops at the end of a whole turn and after at least `minTurns` turns.
 *
 * @param {number} startedAt  when the spin began (performance.now())
 * @param {number} now  performance.now()
 * @param {{ turn: number, minTurns: number }} timing  REFRESH_SPIN
 * @returns {number}
 */
export function spinRemainingMs(startedAt, now, { turn, minTurns }) {
  const turnMs = turn * 1000;
  const elapsed = Math.max(0, now - startedAt);
  const turns = Math.max(minTurns, Math.ceil(elapsed / turnMs));
  return turns * turnMs - elapsed;
}
