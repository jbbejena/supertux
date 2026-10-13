// Persisted room policy. Transport heartbeats never extend these deadlines.
export const INVITATION_MS = 15 * 60 * 1000;
export const SESSION_MS = 60 * 60 * 1000;
export const IDLE_MS = 10 * 60 * 1000;
export const WARNING_MS = 2 * 60 * 1000;

export function newLifetime(now) {
  return {lifetimePolicy: 1, expires: now + INVITATION_MS, startedAt: null,
    sessionExpires: null, idleExpires: null, playing: false,
    lifetimeRevision: 0, lifetimeKey: ''};
}

export function updateLifetime(room, paired, playing, now) {
  if (room.lifetimePolicy !== 1) return false; // Pre-update rooms retain their original cap.
  playing = paired && playing;
  if (room.startedAt === null && paired) {
    room.startedAt = now;
    room.sessionExpires = now + SESSION_MS;
    room.idleExpires = playing ? null : now + IDLE_MS;
    room.playing = playing;
    return true;
  }
  if (room.startedAt !== null && room.playing !== playing) {
    room.playing = playing;
    room.idleExpires = playing ? null : now + IDLE_MS;
    return true;
  }
  return false;
}

export function lifetimeStatus(room, now) {
  let kind = 'invitation', expires = room.expires;
  if (room.lifetimePolicy !== 1) kind = 'legacy';
  else if (room.startedAt !== null) {
    kind = 'session'; expires = room.sessionExpires;
    if (room.idleExpires !== null && room.idleExpires < expires) {
      kind = 'idle'; expires = room.idleExpires;
    }
  }
  if (!Number.isSafeInteger(expires) || expires < 0) expires = 0;
  return {kind, expires, remainingMs: Math.max(0, expires - now),
    warning: expires - now <= WARNING_MS};
}

export function expiryReason(kind) {
  return {invitation: 'Room invitation expired', idle: 'Room idle limit reached',
    session: 'Room session limit reached', legacy: 'Room expired'}[kind];
}
