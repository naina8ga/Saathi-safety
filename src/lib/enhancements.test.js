import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBattery, batteryLabel, isLowBattery } from "./device.js";
import { buildIncidentRecord, addToHistory, historyStats, formatDuration, incidentReportText } from "./history.js";

test("battery is normalised to a whole percentage and never invented", () => {
  assert.deepEqual(normalizeBattery({ level: 0.834, charging: true }), { level: 83, charging: true });
  assert.deepEqual(normalizeBattery({ level: 2, charging: false }), { level: 100, charging: false });
  assert.equal(normalizeBattery(null), null);
  assert.equal(normalizeBattery({ level: "abc" }), null);
  assert.match(batteryLabel(null), /Not available/);
  assert.equal(batteryLabel({ level: 40, charging: true }), "40% · charging");
});

test("low battery only counts when not charging", () => {
  assert.equal(isLowBattery({ level: 10, charging: false }), true);
  assert.equal(isLowBattery({ level: 10, charging: true }), false);
  assert.equal(isLowBattery({ level: 60, charging: false }), false);
  assert.equal(isLowBattery(null), false);
});

test("durations are readable", () => {
  assert.equal(formatDuration(42000), "42 s");
  assert.equal(formatDuration(185000), "3 min 5 s");
  assert.equal(formatDuration(3720000), "1 h 2 min");
  assert.equal(formatDuration(NaN), "—");
});

const contacts = [{ id: 1, name: "Mum", live: true }, { id: 2, name: "Aarav" }];
const incident = {
  id: "SA-1", status: "resolved", startedAt: "2026-11-01T10:00:00.000Z", resolvedAt: "2026-11-01T10:05:00.000Z",
  source: "SOS button", message: "help", notified: [1, 2], acknowledged: [1], escalated: true,
  ackedAt: { 1: "2026-11-01T10:00:42.000Z" }, delivery: { state: "delivered", receivers: 1 }, device: { battery: { level: 55, charging: false } }
};
const events = [
  { incidentId: "SA-1", title: "Escalated to Aarav", detail: "x", type: "warning", status: "simulated", time: "10:02", date: "d" },
  { incidentId: "SA-1", title: "Location attached", detail: "y", type: "success", status: "completed", time: "10:00", date: "d" },
  { incidentId: "OTHER", title: "Unrelated", detail: "z", type: "info", status: "completed", time: "09:00", date: "d" }
];

test("incident record captures outcome and only this incident's events", () => {
  const r = buildIncidentRecord({ incident, contacts, events, extraEvents: [{ title: "User confirmed resolution", detail: "ok", type: "success", status: "completed", time: "10:05", date: "d" }] });
  assert.equal(r.durationMs, 300000);
  assert.equal(r.firstResponseMs, 42000);
  assert.equal(r.escalated, true);
  assert.equal(r.delivery, "delivered");
  assert.equal(r.locationAttached, true);
  assert.deepEqual(r.battery, { level: 55, charging: false });
  assert.equal(r.events.length, 3);
  assert.equal(r.events[0].title, "Location attached"); // oldest first
  assert.equal(r.events.at(-1).title, "User confirmed resolution");
  assert.equal(r.notified.find((n) => n.id === 2).acknowledged, false);
});

test("history keeps newest first, de-duplicates and caps", () => {
  const a = { id: "A" }, b = { id: "B" };
  let h = addToHistory([], a);
  h = addToHistory(h, b);
  assert.deepEqual(h.map((x) => x.id), ["B", "A"]);
  h = addToHistory(h, { id: "A", updated: true });
  assert.deepEqual(h.map((x) => x.id), ["A", "B"]);
  assert.equal(addToHistory(h, { id: "C" }, 2).length, 2);
});

test("stats ignore incidents nobody answered", () => {
  const s = historyStats([{ firstResponseMs: 10000, escalated: true }, { firstResponseMs: 30000, escalated: false }, { firstResponseMs: null, escalated: false }]);
  assert.deepEqual(s, { total: 3, escalated: 1, answered: 2, avgResponseMs: 20000 });
});

test("report text is honest about simulated contacts", () => {
  const t = incidentReportText(buildIncidentRecord({ incident, contacts, events }));
  assert.match(t, /Aarav \(simulated\): no acknowledgement/);
  assert.match(t, /Mum \(live link\): acknowledged after 42 s/);
});
