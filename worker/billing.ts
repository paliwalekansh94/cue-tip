// Cue Tip v0.3 billing core. All monetary values are integer paise.
// Each completed continuous-rate segment is billed by the second, and the
// final session total is rounded up to the next whole rupee.
export type RateSegment = { startedAt: number; endedAt: number; ratePaisePerMinute: number };
export type Pause = { startedAt: number; endedAt: number };
export function chargePaise(segments: RateSegment[], pauses: Pause[]): number {
  let weighted = 0;
  for (const s of segments) {
    if (!Number.isFinite(s.startedAt) || !Number.isFinite(s.endedAt) ||
        !Number.isSafeInteger(s.ratePaisePerMinute) ||
        s.endedAt < s.startedAt || s.ratePaisePerMinute < 0) throw new Error('Invalid rate segment');
    let activeMs = s.endedAt - s.startedAt;
    for (const p of pauses) {
      if (p.endedAt < p.startedAt) throw new Error('Invalid pause');
      activeMs -= Math.max(0, Math.min(s.endedAt, p.endedAt) - Math.max(s.startedAt, p.startedAt));
    }
    weighted += Math.max(0, activeMs) * s.ratePaisePerMinute;
  }
  return Math.ceil(weighted / 60000 / 100) * 100;
}
export function ratePaise(base: number, extra: number, players: number): number {
  if (!Number.isInteger(players) || players < 1 || players > 20) throw new Error('Invalid player count');
  return base + Math.max(0, players - 2) * extra;
}
