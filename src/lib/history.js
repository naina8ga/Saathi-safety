// Turns a finished incident into a compact, self-contained record for the history page.
// Pure functions only (no React, no browser APIs) so they can be unit-tested in Node.

export const MAX_HISTORY = 50;
const MAX_RECORD_EVENTS = 80;

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

// events are newest-first (as the app stores them); extraEvents are even newer and not stored yet.
export function buildIncidentRecord({ incident, contacts = [], events = [], extraEvents = [] }) {
  if (!incident) return null;
  const startedMs = new Date(incident.startedAt).getTime();
  const endedMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : null;
  const ackedAt = incident.ackedAt || {};
  const notified = (incident.notified || []).map((id) => {
    const c = contacts.find((x) => x.id === id);
    const acknowledged = (incident.acknowledged || []).includes(id);
    const at = acknowledged ? ackedAt[id] || null : null;
    return {
      id, name: c?.name || "Removed contact", live: Boolean(c?.live), acknowledged, ackedAt: at,
      responseMs: at && Number.isFinite(startedMs) ? Math.max(0, new Date(at).getTime() - startedMs) : null
    };
  });
  const responses = notified.map((n) => n.responseMs).filter((n) => Number.isFinite(n));
  const own = [...extraEvents, ...events.filter((e) => e.incidentId === incident.id)].slice(0, MAX_RECORD_EVENTS).reverse();
  return {
    id: incident.id,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt || null,
    source: incident.source || "SOS",
    message: incident.message || "",
    durationMs: endedMs && Number.isFinite(startedMs) ? Math.max(0, endedMs - startedMs) : null,
    notified,
    escalated: Boolean(incident.escalated),
    delivery: incident.delivery?.state || null,
    battery: incident.device?.battery || null,
    locationAttached: own.some((e) => e.title === "Location attached"),
    firstResponseMs: responses.length ? Math.min(...responses) : null,
    events: own.map(({ time, date, title, detail, type, status }) => ({ time, date, title, detail, type, status }))
  };
}

export function addToHistory(history, record, max = MAX_HISTORY) {
  if (!record) return history;
  return [record, ...history.filter((h) => h.id !== record.id)].slice(0, max);
}

export function historyStats(history) {
  const responses = history.map((h) => h.firstResponseMs).filter((n) => Number.isFinite(n));
  return {
    total: history.length,
    escalated: history.filter((h) => h.escalated).length,
    answered: responses.length,
    avgResponseMs: responses.length ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length) : null
  };
}

export function incidentReportText(r) {
  const lines = [
    `Saathi incident report · ${r.id}`,
    `Started: ${new Date(r.startedAt).toLocaleString()}`,
    `Resolved: ${r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : "not resolved"}`,
    `Duration: ${formatDuration(r.durationMs)}`,
    `Source: ${r.source}`,
    `Message: ${r.message || "—"}`,
    `Delivery to live-link contact: ${r.delivery || "n/a"}`,
    `Escalated: ${r.escalated ? "yes" : "no"}`,
    `Location attached: ${r.locationAttached ? "yes" : "no"}`,
    `Battery at start: ${r.battery ? `${r.battery.level}%${r.battery.charging ? " (charging)" : ""}` : "not available"}`,
    `First acknowledgement: ${Number.isFinite(r.firstResponseMs) ? formatDuration(r.firstResponseMs) : "none recorded"}`,
    "",
    "Contacts notified:",
    ...(r.notified.length
      ? r.notified.map((n) => `- ${n.name}${n.live ? " (live link)" : " (simulated)"}: ${n.acknowledged ? `acknowledged${Number.isFinite(n.responseMs) ? ` after ${formatDuration(n.responseMs)}` : ""}` : "no acknowledgement"}`)
      : ["- none"]),
    "",
    "Timeline (oldest first):",
    ...r.events.map((e) => `${e.date} | ${e.title} | ${e.detail} | ${e.status}`),
    "",
    "Prototype note: only the live-link contact receives real alerts; other contacts are simulated."
  ];
  return lines.join("\n");
}
