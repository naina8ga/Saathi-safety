import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/lib/intent.js";
import { isFresh, formatCountdown, mergeMessages, escalationStatus, escalationAction } from "../src/lib/safety.js";

const contacts = [
  { id: 1, name: "Mum", enabled: true, live: true },
  { id: 2, name: "Aarav", enabled: true },
  { id: 3, name: "Campus", enabled: false }
];
const inc = (o = {}) => ({ id: "X", status: "active", notified: [1], acknowledged: [], escalationDeadline: 10_000, ...o });

test("intent: English, Hindi and Hinglish distress", () => {
  for (const t of ["someone is following me", "मेरा पीछा कर रहा है", "mujhe darr lag raha hai", "help me"]) assert.equal(classifyIntent(t).intent, "distress", t);
});
test("intent: other intents and fallback", () => {
  assert.equal(classifyIntent("Mummy ko meri location bhejo").intent, "share_location");
  assert.equal(classifyIntent("start a journey check-in").intent, "journey_checkin");
  assert.equal(classifyIntent("call me please").intent, "request_call");
  assert.equal(classifyIntent("hello there").intent, "general_support");
  assert.deepEqual(classifyIntent("hello there").matched, []);
});
test("intent: no false match inside other words", () => {
  assert.equal(classifyIntent("I will assess the situation later").intent, "general_support");
});
test("location freshness rejects old, future, missing and invalid fixes", () => {
  const now = Date.now();
  const mk = (ageMs) => ({ lat: 1, lng: 2, capturedAt: new Date(now - ageMs).toISOString() });
  assert.equal(isFresh(mk(1000), 300000, now), true);
  assert.equal(isFresh(mk(301000), 300000, now), false);
  assert.equal(isFresh(mk(-5000), 300000, now), false);
  assert.equal(isFresh(null), false);
  assert.equal(isFresh({ lat: NaN, lng: 1, capturedAt: new Date().toISOString() }), false);
  assert.equal(isFresh({ lat: 1, lng: 2 }), false);
});
test("countdown format", () => {
  assert.equal(formatCountdown(60000), "1:00");
  assert.equal(formatCountdown(61500), "1:02");
  assert.equal(formatCountdown(-5), "0:00");
});
test("mergeMessages dedupes by id", () => {
  const a = [{ id: "1", text: "a" }];
  assert.equal(mergeMessages(a, [{ id: "1", text: "a" }, { id: "2", text: "b" }]).length, 2);
});
test("escalation: waits, then fires when deadline passes", () => {
  const args = { incident: inc(), contacts, autoEscalate: true };
  assert.equal(escalationAction({ ...args, now: 5000 }), "wait");
  assert.equal(escalationStatus({ ...args, now: 4000 }).remainingMs, 6000);
  assert.equal(escalationStatus({ ...args, now: 4000 }).next.name, "Aarav");
  assert.equal(escalationAction({ ...args, now: 10_000 }), "fire");
});
test("escalation: skips disabled contacts and stops when chain is exhausted", () => {
  const i = inc({ notified: [1, 2] });
  assert.equal(escalationStatus({ incident: i, contacts, autoEscalate: true, now: 0 }).state, "exhausted");
  assert.equal(escalationAction({ incident: i, contacts, autoEscalate: true, now: 0 }), "stop");
});
test("escalation: acknowledgement stops the timer; policy off never auto-fires", () => {
  assert.equal(escalationAction({ incident: inc({ acknowledged: [1] }), contacts, autoEscalate: true, now: 99_999 }), "stop");
  assert.equal(escalationAction({ incident: inc(), contacts, autoEscalate: false, now: 99_999 }), "wait");
  assert.equal(escalationStatus({ incident: inc(), contacts, autoEscalate: false }).state, "manual");
});
test("escalation: resolved or missing incident is idle", () => {
  assert.equal(escalationStatus({ incident: inc({ status: "resolved" }), contacts, autoEscalate: true }).state, "idle");
  assert.equal(escalationAction({ incident: null, contacts, autoEscalate: true }), "wait");
});
