// Pure helpers for the safety workflow. Kept free of React so they can be unit-tested in Node.

export const LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

export function isFresh(loc, maxAgeMs = LOCATION_MAX_AGE_MS, now = Date.now()) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || !loc.capturedAt) return false;
  const age = now - new Date(loc.capturedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function mergeMessages(prev, incoming) {
  const seen = new Set(prev.map((m) => m.id).filter(Boolean));
  const next = [...prev];
  for (const m of incoming) {
    if (m.id && seen.has(m.id)) continue;
    if (m.id) seen.add(m.id);
    next.push(m);
  }
  return next.slice(-100);
}

export const pendingContactIds = (incident) =>
  (incident?.notified || []).filter((id) => !(incident?.acknowledged || []).includes(id));

export const nextEscalationContact = (incident, contacts) =>
  contacts.find((c) => c.enabled && !(incident?.notified || []).includes(c.id)) || null;

// Describes where the escalation timer stands. `now` is injected so tests are deterministic.
export function escalationStatus({ incident, contacts, autoEscalate, now = Date.now() }) {
  if (!incident || incident.status !== "active") return { state: "idle" };
  const pending = pendingContactIds(incident);
  const next = nextEscalationContact(incident, contacts);
  if ((incident.notified || []).length > 0 && pending.length === 0) return { state: "acknowledged" };
  if (!autoEscalate) return { state: "manual", next };
  if (!next) return { state: "exhausted" };
  if (!incident.escalationDeadline) return { state: "manual", next };
  return { state: "counting", next, remainingMs: Math.max(0, incident.escalationDeadline - now) };
}

// What the 1-second ticker should do right now: "fire" (escalate), "stop" (clear the timer), or "wait".
export function escalationAction({ incident, contacts, autoEscalate, now = Date.now() }) {
  const s = escalationStatus({ incident, contacts, autoEscalate, now });
  if (s.state === "acknowledged" && incident.escalationDeadline) return "stop";
  if (s.state === "exhausted" && incident.escalationDeadline) return "stop";
  if (s.state === "counting" && s.remainingMs <= 0) return "fire";
  return "wait";
}
