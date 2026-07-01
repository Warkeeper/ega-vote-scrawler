export function minutesBetween(previousIso, currentIso) {
  const previous = new Date(previousIso).getTime();
  const current = new Date(currentIso).getTime();
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.max(0, Math.round(((current - previous) / 60000) * 10) / 10);
}

export function buildDelta(previous, current, capturedAt) {
  if (!previous) return null;

  return {
    previousSnapshotId: previous.id,
    minutesSincePrevious: minutesBetween(previous.captured_at, capturedAt),
    publicDelta: current.publicVotes - previous.public_votes,
    vipDelta: current.vipVotes - previous.vip_votes
  };
}
