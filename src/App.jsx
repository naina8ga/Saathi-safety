import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import MapView from "./MapView";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownRight, ArrowRight, Bell, BrainCircuit,
  Check, CheckCheck, CheckCircle2, ChevronRight, Clock3, Compass, Copy,
  Home, LifeBuoy, LocateFixed, LockKeyhole, MapPin, Menu, MessageCircle,
  Mic, Navigation, Phone, Plus, Radio, Settings, Shield, ShieldAlert,
  ShieldCheck, Siren, Sparkles, Timer, Trash2, Users, X, Zap, Download, Hourglass,
  History as HistoryIcon, PhoneIncoming, ChevronDown
} from "lucide-react";
import FakeCall, { primeAudio } from "./FakeCall";
import Helplines from "./Helplines";
import { watchBattery, batteryLabel, isLowBattery } from "./lib/device";
import { buildIncidentRecord, addToHistory, historyStats, formatDuration, incidentReportText } from "./lib/history";
import "./enhancements.css";
import { classifyIntent } from "./lib/intent";
import {
  LOCATION_MAX_AGE_MS, isFresh, formatCountdown, mergeMessages, pendingContactIds,
  nextEscalationContact, escalationStatus, escalationAction
} from "./lib/safety";

const STORAGE_KEY = "saathi-prototype-v1";
const SAATHI_ROOM = "SAATHI-JIIT-DEMO";
// Default to the same host the page was opened from, so the LAN demo works without editing .env.
const SERVER_URL = import.meta.env.VITE_SERVER_URL
  || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:4000` : "http://localhost:4000");
const MAX_EVENTS = 300;
const LIVE_LOCATION_MIN_INTERVAL_MS = 10000;
const initialContacts = [
  { id: 1, name: "Mum", relation: "Family", phone: "+91 98765 43210", initials: "M", color: "rose", enabled: true, live: true },
  { id: 2, name: "Aarav", relation: "Friend", phone: "+91 98765 12345", initials: "A", color: "violet", enabled: true },
  { id: 3, name: "Campus Security", relation: "Safety desk", phone: "+91 120 240 0000", initials: "CS", color: "teal", enabled: true }
];

const navItems = [
  { id: "home", label: "Overview", icon: Home },
  { id: "incident", label: "Live incident", icon: Radio },
  { id: "map", label: "Explore map", icon: MapPin },
  { id: "agents", label: "Agent center", icon: BrainCircuit },
  { id: "assistant", label: "Safety assistant", icon: MessageCircle },
  { id: "fakecall", label: "Fake call", icon: PhoneIncoming },
  { id: "helplines", label: "Helplines", icon: Phone },
  { id: "timeline", label: "Activity timeline", icon: Activity },
  { id: "history", label: "Incident history", icon: HistoryIcon },
  { id: "settings", label: "Preferences", icon: Settings }
];

const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateStamp = () => new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const makeId = () => `SA-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (value) return value;
  } catch {}
  return null;
}

const newMessageId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Exactly one contact is the "live link": the person who uses the separate Mother Client app.
function migrateContacts(savedContacts) {
  const list = Array.isArray(savedContacts) ? savedContacts : initialContacts;
  if (list.some(c => c.live)) return list;
  return list.map(c => (c.id === 1 ? { ...c, live: true } : c)); // data saved by older versions
}

const readPosition = (pos) => ({
  lat: pos.coords.latitude, lng: pos.coords.longitude,
  accuracy: Math.round(pos.coords.accuracy), capturedAt: new Date().toISOString()
});

// Laptops usually have no GPS, so a high-accuracy request often times out or fails even though
// Wi-Fi/IP positioning would work. Retry once with the lower accuracy setting (never when the
// user denied permission). capturedAt is always "now", so freshness checks stay honest.
function getPosition(onOk, onFail) {
  navigator.geolocation.getCurrentPosition(onOk, (err) => {
    if (err.code === 1) { onFail(err); return; }
    navigator.geolocation.getCurrentPosition(onOk, onFail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
}

function saveTextFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const FAKE_DELAYS = [["0", "Right now"], ["10", "In 10 seconds"], ["30", "In 30 seconds"], ["60", "In 1 minute"], ["120", "In 2 minutes"], ["300", "In 5 minutes"]];

function ArrowUpRightIcon() { return <ArrowRight size={13}/>; }

function PageTitle({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function StatusChip({ children, tone = "neutral" }) { return <span className={`status-chip ${tone}`}>{children}</span>; }

function AgentStrip() {
  return (
    <div className="agent-strip">
      <div className="agent-strip-heading"><Sparkles size={15}/> <span>AGENTIC WORKFLOW</span><span className="agent-live">READY</span></div>
      <div className="agent-flow">
        {[["01","Intent Agent","Understand"],["02","Safety Planner","Plan"],["03","Coordinator","Act"],["04","Verifier","Verify"]].map((a,i) =>
          <React.Fragment key={a[0]}><div className="agent-step"><div className="agent-number">{a[0]}</div><div><b>{a[1]}</b><small>{a[2]}</small></div></div>{i<3 && <ArrowRight className="agent-arrow" size={15}/>}</React.Fragment>
        )}
      </div>
    </div>
  );
}

function App({ initialPage = "home" } = {}) {
  const saved = useMemo(readSaved, []);
  const [page, setPage] = useState(initialPage);
  const [contacts, setContacts] = useState(() => migrateContacts(saved?.contacts));
  const [incident, setIncident] = useState(saved?.incident || null);
  const [events, setEvents] = useState(saved?.events || []);
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("not-shared");
  const [message, setMessage] = useState("");
  const [assistantReply, setAssistantReply] = useState(null);
  const [journeyActive, setJourneyActive] = useState(saved?.journeyActive || false);
  const [checkinMinutes, setCheckinMinutes] = useState(saved?.checkinMinutes || "30");
  const [escalationSeconds, setEscalationSeconds] = useState(saved?.escalationSeconds || "60");
  const [shareOnSOS, setShareOnSOS] = useState(saved?.shareOnSOS ?? true);
  const [autoEscalate, setAutoEscalate] = useState(saved?.autoEscalate ?? true);
  const [toast, setToast] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [motherMessages, setMotherMessages] = useState([]);
  const [outgoingMessage, setOutgoingMessage] = useState("");
  const [motherOnline, setMotherOnline] = useState(false);
  const [liveLocation, setLiveLocation] = useState(saved?.liveLocation ?? false);
  const [journeyEndsAt, setJourneyEndsAt] = useState(saved?.journeyEndsAt || null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [battery, setBattery] = useState(null);
  const [history, setHistory] = useState(() => saved?.history || (saved?.incident?.status === "resolved"
    ? [buildIncidentRecord({ incident: saved.incident, contacts: migrateContacts(saved.contacts), events: saved.events || [] })] : []));
  const [expandedId, setExpandedId] = useState(null);
  const [fakeCaller, setFakeCaller] = useState(saved?.fakeCaller || "Mum");
  const [fakeDelay, setFakeDelay] = useState(saved?.fakeDelay || "10");
  const [fakeRing, setFakeRing] = useState(saved?.fakeRing ?? true);
  const [fakeCall, setFakeCall] = useState(null); // null | { stage: scheduled|ringing|connected, callerName, at, connectedAt }
  // Refs always hold the latest values, so socket/timer callbacks never act on stale state.
  const socketRef = useRef(null);
  const incidentRef = useRef(incident);
  const contactsRef = useRef(contacts);
  const locationRef = useRef(location);
  const settingsRef = useRef({});
  const motherOnlineRef = useRef(false);
  const escalateRef = useRef(null);
  const liveShareLoggedRef = useRef(null);
  const eventsRef = useRef(events);
  const batteryRef = useRef(null);
  const lowBatteryLoggedRef = useRef(null);
  incidentRef.current = incident;
  contactsRef.current = contacts;
  locationRef.current = location;
  motherOnlineRef.current = motherOnline;
  settingsRef.current = { shareOnSOS, liveLocation, autoEscalate };
  eventsRef.current = events;
  batteryRef.current = battery;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        contacts, incident, events: events.slice(0, MAX_EVENTS), journeyActive, journeyEndsAt,
        checkinMinutes, escalationSeconds, shareOnSOS, autoEscalate, liveLocation,
        history, fakeCaller, fakeDelay, fakeRing
      }));
    } catch {}
  }, [contacts, incident, events, journeyActive, journeyEndsAt, checkinMinutes, escalationSeconds, shareOnSOS, autoEscalate, liveLocation, history, fakeCaller, fakeDelay, fakeRing]);

  useEffect(() => watchBattery(setBattery), []);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket", "polling"], reconnection: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      setServerConnected(true);
      socket.emit("room:join", { room: SAATHI_ROOM, role: "woman", displayName: "Saathi user" });
    });
    socket.on("disconnect", () => { setServerConnected(false); setMotherOnline(false); });
    socket.on("connect_error", () => { setServerConnected(false); setMotherOnline(false); });
    socket.on("state:sync", (s) => {
      setMotherOnline(Boolean(s?.presence?.mother));
      if (Array.isArray(s?.messages)) setMotherMessages(prev => mergeMessages(prev, s.messages));
    });
    socket.on("presence:update", (p) => { if (p?.role === "mother") setMotherOnline(p.status === "online"); });
    socket.on("incident:acknowledged", (payload) => {
      const current = incidentRef.current;
      if (!current || current.id !== payload.incidentId) return;
      const liveId = contactsRef.current.find(c => c.live)?.id;
      setIncident(prev => (!prev || prev.id !== payload.incidentId) ? prev : {
        ...prev, acknowledged: [...new Set([...(prev.acknowledged || []), ...(liveId ? [liveId] : [])])],
        ackedAt: liveId ? { ...(prev.ackedAt || {}), [liveId]: prev.ackedAt?.[liveId] || payload.acknowledgedAt || new Date().toISOString() } : (prev.ackedAt || {})
      });
      addEvent("Mother acknowledged the alert", `${payload.from || "Mother"} acknowledged incident ${payload.incidentId} through the live Mother Client. This is a real response over the server channel.`, "success", "received", payload.incidentId);
      addEvent("Verification Agent", "Verified: a person on the Mother Client confirmed receipt. This shows she saw the alert, not that help has arrived.", "agent", "completed", payload.incidentId);
      setToast("Mother has acknowledged your SOS.");
    });
    socket.on("chat:message", (m) => {
      setMotherMessages(prev => mergeMessages(prev, [m]));
      if (m.senderRole === "mother") {
        addEvent("Message received from Mother", m.text, "info", "received");
        setToast("New message from Mother.");
      } else if (m.senderRole === "woman") {
        addEvent("Message sent to Mother", m.text, "info", motherOnlineRef.current ? "delivered" : "pending");
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const addEvent = (title, detail, type = "info", status = "completed", incidentId = incidentRef.current?.id ?? null) => {
    setEvents(prev => [{ id: `${Date.now()}-${Math.random()}`, incidentId, time: stamp(), date: dateStamp(), title, detail, type, status }, ...prev].slice(0, MAX_EVENTS));
  };

  const liveContact = contacts.find(c => c.live) || null;
  const liveNotified = Boolean(incident && liveContact && (incident.notified || []).includes(liveContact.id));

  // Only a fix newer than 5 minutes may ever be attached to an alert, and only if the user allowed it.
  const shareableLocation = () => (settingsRef.current.shareOnSOS && isFresh(locationRef.current, LOCATION_MAX_AGE_MS) ? locationRef.current : null);

  const pushLocationToLiveContact = (loc) => {
    const inc = incidentRef.current;
    const live = contactsRef.current.find(c => c.live);
    if (!inc || inc.status !== "active" || !live || !(inc.notified || []).includes(live.id)) return;
    if (!settingsRef.current.shareOnSOS) return;
    socketRef.current?.emit("location:update", {
      incidentId: inc.id, location: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, capturedAt: loc.capturedAt }
    });
  };

  const applyLocation = (loc) => {
    locationRef.current = loc;
    setLocation(loc);
    setLocationStatus("available");
    pushLocationToLiveContact(loc);
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      addEvent("Location unavailable", "This browser does not support location access.", "warning", "failed");
      setToast("Location is not available in this browser.");
      return;
    }
    setLocationStatus("requesting");
    getPosition(
      pos => {
        const loc = readPosition(pos);
        applyLocation(loc);
        addEvent("Location permission granted", `Coordinates retrieved with approximately ${loc.accuracy} m accuracy.`, "success");
        const sharing = incidentRef.current?.status === "active" && settingsRef.current.shareOnSOS;
        setToast(sharing ? "Location updated and sent to your live-link contact." : "Location retrieved. It is not shared until an incident workflow uses it.");
      },
      err => {
        setLocationStatus("unavailable");
        addEvent("Location permission unavailable", err.code === 1 ? "Permission was denied. No location was shared." : "The browser could not retrieve a location.", "warning", "failed");
        setToast("Location unavailable. You can still use SOS.");
      }
    );
  };

  // The SOS is never delayed by GPS: the alert goes out first, a fresh fix follows when it arrives.
  const requestFreshLocationForIncident = (id) => {
    if (!navigator.geolocation) {
      addEvent("Location unavailable", "This browser does not support location access.", "warning", "failed", id);
      return;
    }
    setLocationStatus("requesting");
    getPosition(
      pos => {
        const loc = readPosition(pos);
        applyLocation(loc);
        addEvent("Location attached", `Fresh fix obtained after SOS; accuracy ±${loc.accuracy} m. Sent to your live-link contact only.`, "success", "completed", id);
      },
      err => {
        setLocationStatus("unavailable");
        addEvent("Location not attached", err.code === 1 ? "Location permission was denied. No location was shared." : "The browser could not get a fix in time. No location was shared.", "warning", "failed", id);
      }
    );
  };

  // Sends the alert to the real Mother Client and records what the server actually confirmed.
  const sendLiveAlert = (record, loc, contactName) => {
    const id = record.id;
    const socket = socketRef.current;
    const patchDelivery = (delivery) => setIncident(prev => (prev && prev.id === id ? { ...prev, delivery } : prev));
    if (!socket?.connected) {
      patchDelivery({ state: "failed" });
      addEvent(`Live delivery to ${contactName} failed`, "The communication server is not connected, so the alert exists only on this device. Start it with `npm run server`, or call 112 now.", "warning", "failed", id);
      addEvent("Verification Agent", "Verified: the alert was NOT delivered to the Mother Client because the server is unreachable.", "agent", "completed", id);
      return;
    }
    socket.timeout(5000).emit("incident:alert", {
      incidentId: id, message: record.message, source: record.source, startedAt: record.startedAt,
      location: loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, capturedAt: loc.capturedAt } : null,
      device: batteryRef.current ? { battery: batteryRef.current } : null,
      senderName: "Saathi user"
    }, (err, res) => {
      if (err || !res?.ok) {
        patchDelivery({ state: "failed" });
        addEvent(`Live delivery to ${contactName} failed`, err ? "The server did not confirm receipt in time." : (res?.error || "The server rejected the alert."), "warning", "failed", id);
        addEvent("Verification Agent", "Verified: delivery to the Mother Client could not be confirmed.", "agent", "completed", id);
      } else if (res.receivers > 0) {
        patchDelivery({ state: "delivered", receivers: res.receivers });
        addEvent(`Alert delivered to ${contactName}`, `The server confirmed that ${res.receivers} connected Mother Client${res.receivers > 1 ? "s" : ""} received the alert in real time. Acknowledgement is still pending.`, "success", "delivered", id);
        addEvent("Verification Agent", "Verified: delivery receipt received from the server. Delivery is confirmed; a human response is not yet.", "agent", "completed", id);
      } else {
        patchDelivery({ state: "stored" });
        addEvent(`Alert stored for ${contactName}`, "The server holds the alert, but no Mother Client is online right now. It will appear as soon as she opens the app. Consider calling her or 112.", "warning", "pending", id);
        addEvent("Verification Agent", "Verified: the server holds the alert but nobody has received it yet.", "agent", "completed", id);
      }
    });
  };

  const notifyContact = (record, contact, loc, announce = true) => {
    const id = record.id;
    if (announce) addEvent(`Alert sent to ${contact.name}`, contact.live ? "Sending over the live Socket.IO channel to the Mother Client…" : "Demo notification queued by the local prototype. Delivery is simulated, not a real SMS or push notification.", "success", contact.live ? "sent" : "simulated", id);
    if (contact.live) sendLiveAlert(record, loc, contact.name);
    else addEvent("Verification Agent", `Verified: ${contact.name} is recorded as notified in the local demo. Delivery is simulated and not confirmed.`, "agent", "completed", id);
  };

  const startIncident = (source = "SOS button", customMessage = "I feel unsafe. Please help me.") => {
    if (incidentRef.current?.status === "active") {
      setPage("incident");
      setToast("Your safety session is already active.");
      return;
    }
    const id = makeId();
    const now = new Date().toISOString();
    const intent = classifyIntent(customMessage);
    const first = contacts.filter(c => c.enabled)[0] || null;
    const shareLoc = shareableLocation();
    const secs = Number(escalationSeconds) || 60;
    const record = {
      id, status: "active", startedAt: now, source, message: customMessage, intent: intent.intent,
      notified: first ? [first.id] : [], acknowledged: [], escalated: false, resolvedAt: null,
      escalationDeadline: first && autoEscalate ? Date.now() + secs * 1000 : null,
      delivery: null, ackedAt: {}, device: { battery: batteryRef.current }
    };
    incidentRef.current = record;
    setIncident(record);
    const log = (title, detail, type, status) => addEvent(title, detail, type, status, id);
    log("Safety session started", `Incident ${id} created from ${source}.`, "danger");
    log("Intent Agent", `Detected: ${intent.label}. Rule-based match on: ${intent.matched.length ? intent.matched.join(", ") : "explicit SOS action"}.`, "agent");
    log("Safety Planner", "Prepared the pre-authorized SOS workflow.", "agent");
    if (shareLoc) log("Location attached", `Fix captured at ${new Date(shareLoc.capturedAt).toLocaleTimeString()}; accuracy ±${shareLoc.accuracy} m.`, "success");
    else if (shareOnSOS) log("Location not attached yet", "No fix newer than 5 minutes is available. Saathi never sends an old or invented location. Requesting a fresh fix without delaying the alert.", "warning", "pending");
    else log("Location sharing is off", "Attaching location on SOS is disabled in Preferences.", "info");
    if (batteryRef.current) log("Device status noted", `Battery ${batteryLabel(batteryRef.current)}. It is included only in alerts to your live-link contact.`, "info");
    if (first) notifyContact(record, first, shareLoc);
    else log("No trusted contacts enabled", "Open Preferences to configure an approved contact. If you are in danger, call 112.", "warning", "failed");
    if (shareOnSOS && !shareLoc) requestFreshLocationForIncident(id);
    setPage("incident");
    setToast("Safety session started.");
  };

  // "Mark received" is a demo control and is never offered for the real, live-linked contact.
  const acknowledge = (contactId) => {
    const contact = contacts.find(c => c.id === contactId);
    const inc = incidentRef.current;
    if (!contact || !inc) return;
    if (contact.live) { setToast(`Only the real ${contact.name} client can acknowledge this.`); return; }
    setIncident(prev => ({
      ...prev, acknowledged: [...new Set([...(prev.acknowledged || []), contactId])],
      ackedAt: { ...(prev.ackedAt || {}), [contactId]: prev.ackedAt?.[contactId] || new Date().toISOString() }
    }));
    addEvent(`${contact.name} acknowledged`, "Acknowledgement recorded by the demo contact control. This is not a real contact response.", "success", "simulated");
    addEvent("Verification Agent", `Verified that the demo acknowledgement control recorded a response for ${contact.name}. No real delivery or assistance is implied.`, "agent", "completed");
    setToast(`${contact.name} marked as acknowledged.`);
  };

  // auto=true is the countdown expiring; auto=false is the user skipping the wait.
  const escalate = (auto = false) => {
    const inc = incidentRef.current;
    if (!inc || inc.status !== "active") return;
    if (!autoEscalate) {
      addEvent("Policy Engine blocked escalation", "Escalation is disabled in Preferences. No additional contact was notified.", "warning", "failed");
      addEvent("Verification Agent", "Verified that the policy engine blocked the action because user authorization is disabled.", "agent", "completed");
      setToast("Escalation is disabled in your preferences.");
      return;
    }
    if (pendingContactIds(inc).length === 0 && (inc.notified || []).length > 0) {
      addEvent("Escalation not required", "Every notified contact has acknowledged the alert, so the coordinator stopped unnecessary escalation.", "success");
      setToast("A contact has acknowledged. No further escalation is needed.");
      return;
    }
    const next = nextEscalationContact(inc, contacts);
    if (!next) {
      addEvent("Escalation checked", "No additional enabled contact is configured. No further alert was sent.", "warning", "failed");
      setToast("No additional trusted contact is configured. If you are in danger, call 112.");
      return;
    }
    const secs = Number(escalationSeconds) || 60;
    const remaining = contacts.find(c => c.enabled && c.id !== next.id && !(inc.notified || []).includes(c.id));
    const updated = {
      ...inc, notified: [...(inc.notified || []), next.id], escalated: true,
      escalationDeadline: remaining ? Date.now() + secs * 1000 : null
    };
    incidentRef.current = updated;
    setIncident(updated);
    if (liveContact && (inc.notified || []).includes(liveContact.id) && !next.live) {
      socketRef.current?.emit("incident:escalation", {
        incidentId: inc.id, contactName: next.name, detail: "Saathi escalated this alert to another configured trusted contact."
      });
    }
    addEvent("Coordination Agent", `Policy check passed: ${next.name} is enabled and has not already been notified.`, "agent", "completed");
    addEvent(`Escalated to ${next.name}`, auto ? `Automatic escalation: nobody acknowledged within the configured ${secs}-second window.` : "Escalation step run manually; the wait window was skipped.", "warning", next.live ? "sent" : "simulated");
    notifyContact(updated, next, shareableLocation(), false);
    if (!remaining) addEvent("Escalation chain complete", "Every enabled contact has now been alerted. If you are in danger, call 112.", "warning", "completed");
    setToast(auto ? `No response yet. Escalated to ${next.name}.` : `Escalation recorded for ${next.name}.`);
  };

  const sendMessageToMother = () => {
    const text = outgoingMessage.trim();
    if (!text) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setToast("Communication server is offline. Message was not sent.");
      return;
    }
    socket.timeout(5000).emit("chat:send", { id: newMessageId(), incidentId: incidentRef.current?.id || null, text }, (err, res) => {
      if (err || !res?.ok) setToast("The server did not confirm your message. Try again.");
    });
    setOutgoingMessage("");
    if (!motherOnline) setToast("Mother Client is offline. The server keeps your message and shows it when she connects.");
  };

  const resolveIncident = () => {
    const inc = incidentRef.current;
    if (!inc) return;
    const resolved = { ...inc, status: "resolved", resolvedAt: new Date().toISOString(), escalationDeadline: null };
    incidentRef.current = resolved;
    setIncident(resolved);
    if (liveNotified) {
      socketRef.current?.emit("incident:resolve", { incidentId: inc.id });
      addEvent("Mother Client informed", "Your live-link contact was told that you marked yourself safe.", "info", "sent");
      if (liveLocation) addEvent("Live location sharing stopped", "Sharing ended when you confirmed you are safe.", "info");
    }
    addEvent("User confirmed resolution", "The user marked this safety session as resolved. This is a user confirmation, not an AI inference.", "success");
    const record = buildIncidentRecord({
      incident: resolved, contacts: contactsRef.current, events: eventsRef.current,
      extraEvents: [{ title: "User confirmed resolution", detail: "The user marked this safety session as resolved. This is a user confirmation, not an AI inference.", type: "success", status: "completed", time: stamp(), date: dateStamp() }]
    });
    setHistory(prev => addToHistory(prev, record));
    setShowResolve(false);
    setPage("summary");
    setToast("Incident marked resolved.");
  };

  const runAgentDemo = () => {
    if (incident?.status === "active") {
      setPage("agents");
      setToast("An incident is already active. Continue the existing workflow.");
      return;
    }
    startIncident("Agent Center controlled demo", "I feel unsafe. Someone may be following me. Please coordinate help.");
    setPage("agents");
    setToast("Controlled agent workflow started. Contact actions are simulated unless a live-link contact is online.");
  };

  const startJourney = () => {
    const mins = Number(checkinMinutes) || 30;
    setJourneyActive(true);
    setJourneyEndsAt(Date.now() + mins * 60000);
    setNowTick(Date.now());
    addEvent("Journey check-in started", `A check-in prompt is scheduled in ${mins} minutes. A missed check-in never triggers SOS on its own; you decide what happens next.`, "success", "completed", null);
    setToast("Journey check-in started.");
  };

  const endJourney = (message = "Journey check-in ended.") => {
    setJourneyActive(false);
    setJourneyEndsAt(null);
    addEvent("Journey check-in ended", "The check-in session was closed by the user.", "info", "completed", null);
    setToast(message);
  };

  const extendJourney = () => {
    setJourneyEndsAt(Date.now() + 15 * 60000);
    setNowTick(Date.now());
    addEvent("Journey check-in extended", "The user extended the check-in by 15 minutes.", "info", "completed", null);
    setToast("Check-in extended by 15 minutes.");
  };

  const scheduleFakeCall = (delaySeconds = Number(fakeDelay) || 0) => {
    primeAudio(); // must run inside the tap so the browser allows the ringtone later
    const callerName = fakeCaller.trim() || "Mum";
    setFakeCall({ stage: delaySeconds <= 0 ? "ringing" : "scheduled", callerName, at: Date.now() + delaySeconds * 1000 });
    setNowTick(Date.now());
    addEvent("Fake call scheduled", `A simulated incoming call from “${callerName}” was set up${delaySeconds > 0 ? ` to ring in ${delaySeconds} s` : " to ring now"}. No real call is placed.`, "info", "completed", null);
    if (delaySeconds > 0) setToast(`Fake call from ${callerName} in ${delaySeconds} s.`);
  };
  const cancelFakeCall = () => { setFakeCall(null); setToast("Fake call cancelled."); };
  const answerFakeCall = () => setFakeCall(prev => (prev ? { ...prev, stage: "connected", connectedAt: Date.now() } : prev));
  const endFakeCall = () => {
    addEvent("Fake call ended", "The simulated call screen was closed by the user.", "info", "completed", null);
    setFakeCall(null);
  };

  const logAsText = () => events.map(e => `${e.date} | ${e.title} | ${e.detail} | ${e.status}`).join("\n");
  const downloadLog = () => {
    const url = URL.createObjectURL(new Blob([logAsText()], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `saathi-activity-log-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("Activity log downloaded.");
  };
  const copyLog = async () => {
    try { await navigator.clipboard.writeText(logAsText()); setToast("Activity log copied to the clipboard."); }
    catch { downloadLog(); setToast("Clipboard not available, so the log was downloaded instead."); }
  };

  const sendAssistant = () => {
    if (!message.trim()) return;
    const result = classifyIntent(message.trim());
    setAssistantReply({ ...result, original: message.trim() });
    addEvent("Assistant request received", `“${message.trim()}” classified as ${result.label}.`, "agent");
    setMessage("");
  };

  const runAssistantAction = () => {
    if (!assistantReply) return;
    if (assistantReply.intent === "distress") startIncident("Safety Assistant", assistantReply.original);
    else if (assistantReply.intent === "journey_checkin") { startJourney(); setPage("home"); }
    else if (assistantReply.intent === "share_location") {
      if (locationStatus !== "available") getLocation();
      setToast("Location permission is required before sharing.");
    } else if (assistantReply.intent === "request_call") {
      const first = contacts.find(c => c.enabled);
      if (first) { addEvent(`Call option prepared for ${first.name}`, "Open the phone app to place the call. Saathi has not placed a call.", "info", "pending"); setToast(`Call ${first.name} using your phone app.`); }
      else setToast("Add a trusted contact in Preferences first.");
    } else setToast("Choose SOS or start a journey check-in to continue.");
  };

  const active = incident?.status === "active";
  const notifiedContacts = contacts.filter(c => (incident?.notified || []).includes(c.id));
  const journeyDue = Boolean(journeyActive && journeyEndsAt && nowTick >= journeyEndsAt);
  const escStatus = escalationStatus({ incident, contacts, autoEscalate, now: nowTick });
  escalateRef.current = escalate;

  // 1-second ticker only while something is actually counting down.
  const needsTick = Boolean((active && incident?.escalationDeadline) || (journeyActive && journeyEndsAt) || fakeCall?.stage === "scheduled");
  useEffect(() => {
    if (!needsTick) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [needsTick]);

  // Coordinator: when the wait window ends with no acknowledgement, escalate (policy permitting).
  useEffect(() => {
    const inc = incidentRef.current;
    const action = escalationAction({ incident: inc, contacts, autoEscalate, now: nowTick });
    if (action === "fire") {
      escalateRef.current?.(true);
    } else if (action === "stop") {
      const status = escalationStatus({ incident: inc, contacts, autoEscalate, now: nowTick });
      const cleared = { ...inc, escalationDeadline: null };
      incidentRef.current = cleared;
      setIncident(cleared);
      if (status.state === "exhausted") addEvent("Escalation chain complete", "Every enabled contact has now been alerted. If you are in danger, call 112.", "warning", "completed");
      else addEvent("Escalation stopped", "Every notified contact has acknowledged, so no further escalation is needed.", "success", "completed");
    }
  }, [nowTick, incident?.acknowledged?.length, incident?.notified?.length, autoEscalate]);

  // Optional, consent-based live location updates while an incident is active.
  useEffect(() => {
    if (!active || !liveLocation || !shareOnSOS || !liveNotified || typeof navigator === "undefined" || !navigator.geolocation) return;
    let last = 0;
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now();
        if (now - last < LIVE_LOCATION_MIN_INTERVAL_MS) return;
        last = now;
        applyLocation(readPosition(pos));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    if (liveShareLoggedRef.current !== incident.id) {
      liveShareLoggedRef.current = incident.id;
      addEvent("Live location sharing started", "Updates go to your live-link contact about every 10 seconds until you confirm you are safe.", "info");
    }
    return () => navigator.geolocation.clearWatch(watchId);
  }, [incident?.id, active, liveLocation, shareOnSOS, liveNotified]);

  // Share battery changes with the live-link contact while an incident is active.
  useEffect(() => {
    const inc = incidentRef.current;
    if (!battery || !inc || inc.status !== "active" || !liveNotified) return;
    socketRef.current?.emit("device:update", { incidentId: inc.id, device: { battery } });
    if (isLowBattery(battery) && lowBatteryLoggedRef.current !== inc.id) {
      lowBatteryLoggedRef.current = inc.id;
      addEvent("Battery low", `Battery is at ${battery.level}% and not charging. Your live-link contact can see this.`, "warning", "completed", inc.id);
    }
  }, [battery?.level, battery?.charging, incident?.id, active, liveNotified]);

  // Fake call: the ring starts when the scheduled time arrives.
  useEffect(() => {
    if (fakeCall?.stage !== "scheduled") return;
    const timer = setTimeout(() => setFakeCall(prev => (prev && prev.stage === "scheduled" ? { ...prev, stage: "ringing" } : prev)), Math.max(0, fakeCall.at - Date.now()));
    return () => clearTimeout(timer);
  }, [fakeCall?.stage, fakeCall?.at]);

  useEffect(() => {
    if (journeyDue) addEvent("Journey check-in due", "The check-in time has arrived. Waiting for you to confirm that you are safe.", "warning", "pending", null);
  }, [journeyDue]);

  const escalationUi = (() => {
    switch (escStatus.state) {
      case "counting": return { headline: "Automatic escalation", detail: `If nobody acknowledges, Saathi alerts ${escStatus.next.name} when the timer ends.`, remainingMs: escStatus.remainingMs };
      case "acknowledged": return { headline: "Acknowledged", detail: "A notified contact responded, so escalation has stopped.", remainingMs: null };
      case "exhausted": return { headline: "All enabled contacts alerted", detail: "Nobody else is left to alert. If you are in danger, call 112.", remainingMs: null };
      case "manual": return { headline: "Manual escalation only", detail: autoEscalate ? "No countdown is running. Use the button to alert the next contact." : "Automatic escalation is off in Preferences.", remainingMs: null };
      default: return { headline: "Adaptive escalation", detail: "Starts counting down when an incident begins.", remainingMs: null };
    }
  })();
  const delivery = incident?.delivery;
  const deliveryItem = !liveNotified ? ["Delivery", "Simulated by prototype; not externally delivered", "warning"]
    : delivery?.state === "delivered" ? ["Delivery", `Server confirmed live delivery to ${delivery.receivers} Mother Client`, "success"]
    : delivery?.state === "stored" ? ["Delivery", "Server holds the alert; Mother Client was offline", "warning"]
    : delivery?.state === "failed" ? ["Delivery", "Could not be delivered to the Mother Client", "warning"]
    : ["Delivery", "Waiting for the server's delivery receipt…", "neutral"];
  const serverBannerState = !serverConnected ? "offline" : motherOnline ? "connected" : "partial";

  const Header = () => (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn mobile-only" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Open menu"><Menu size={19}/></button>
        <div className="breadcrumb">Workspace <ChevronRight size={14}/> <span>{navItems.find(n => n.id === page)?.label || "Incident summary"}</span></div>
      </div>
      <div className="topbar-right">
        <span className="system-pill"><span className="live-dot"/> Prototype environment</span>
        <button className="icon-btn" title="Notifications" onClick={() => setToast("No new system notifications.")}><Bell size={18}/></button>
        <div className="avatar avatar-small">S</div>
      </div>
    </header>
  );

  const Sidebar = () => (
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
      <div className="brand">
        <div className="brand-mark"><ShieldCheck size={23}/></div>
        <div><div className="brand-name">saathi<span>.</span></div><div className="brand-sub">SAFETY, COORDINATED</div></div>
        <button className="icon-btn sidebar-close mobile-only" onClick={() => setMobileMenu(false)}><X size={18}/></button>
      </div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav className="nav-list">
        {navItems.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={`nav-item ${page === item.id ? "selected" : ""}`} onClick={() => { setPage(item.id); setMobileMenu(false); }}>
            <Icon size={18}/><span>{item.label}</span>{item.id === "incident" && active && <i className="nav-alert"/>}
          </button>;
        })}
      </nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-safety-card">
        <div className="mini-shield"><Shield size={17}/></div>
        <div className="safety-card-title">Need urgent help?</div>
        <p>India's emergency response number</p>
        <a href="tel:112" className="call-112"><Phone size={14}/> Call 112 <ArrowUpRightIcon/></a>
      </div>
      <div className="sidebar-footer"><span className="footer-dot"/> Stored on this device · alerts reach approved contacts only</div>
    </aside>
  );

  const HomePage = () => (
    <>
      <PageTitle eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()} title="Your safety, at a glance." subtitle="A calmer way to get help when you need it." action={<div className="secure-label"><LockKeyhole size={14}/> Privacy-first by design</div>}/>
      {active && <div className="active-banner"><div className="active-banner-icon"><Radio size={19}/></div><div><b>Safety session is active</b><span>Incident {incident.id} · Started {new Date(incident.startedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span></div><button className="btn btn-dark btn-sm" onClick={() => setPage("incident")}>View incident <ArrowRight size={15}/></button></div>}
      <div className="home-grid">
        <section className="panel sos-panel">
          <div className="panel-topline"><span className="eyebrow">EMERGENCY ASSISTANCE</span><StatusChip tone={active ? "danger" : "success"}>{active ? "SESSION ACTIVE" : "READY WHEN YOU ARE"}</StatusChip></div>
          <div className="sos-content">
            <div className="sos-orbit orbit-one"/><div className="sos-orbit orbit-two"/>
            <button className={`sos-button ${active ? "sos-active" : ""}`} onClick={() => startIncident("SOS button")} disabled={active}>
              <ShieldAlert size={35}/><strong>{active ? "ACTIVE" : "SOS"}</strong><span>{active ? "SESSION RUNNING" : "TAP FOR HELP"}</span>
            </button>
          </div>
          <h2>{active ? "We're coordinating your plan." : "You don't have to handle it alone."}</h2>
          <p className="panel-description">{active ? "Your incident is open. Check contact acknowledgements and the next permitted action." : "Start a pre-authorized response workflow. Your trusted circle will be notified using the demo coordination service."}</p>
          <div className="sos-actions"><button className="btn btn-danger" disabled={active} onClick={() => startIncident("SOS button")}>{active ? "Safety session active" : "Activate SOS"} <ArrowRight size={16}/></button><button className="btn btn-quiet" onClick={() => setPage("assistant")}><MessageCircle size={16}/> Talk to Saathi</button></div>
          <div className="sos-footnote"><LockKeyhole size={13}/> SOS follows your configured contact preferences. Demo alerts are simulated.</div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><div className="eyebrow">QUICK ACCESS</div><h2>Safety tools</h2></div><span className="icon-tile"><Zap size={17}/></span></div>
          <button className="quick-action" onClick={getLocation}><span className="quick-icon mint"><MapPin size={18}/></span><span><b>Get my location</b><small>{locationStatus === "available" ? "Location retrieved · permission granted" : "Use device location with permission"}</small></span><ChevronRight size={17}/></button>
          <button className="quick-action" onClick={() => (journeyActive ? endJourney() : startJourney())}><span className="quick-icon lavender"><Timer size={18}/></span><span><b>{journeyActive ? "End journey check-in" : "Journey check-in"}</b><small>{journeyActive ? (journeyEndsAt ? `Active · check-in prompt in ${formatCountdown(journeyEndsAt - nowTick)}` : `Active · ${checkinMinutes} min reminder`) : "Prompts you to confirm you are safe after a set time"}</small></span><ChevronRight size={17}/></button>
          <button className="quick-action" onClick={() => setPage("settings")}><span className="quick-icon peach"><Users size={18}/></span><span><b>Trusted circle</b><small>{contacts.filter(c=>c.enabled).length} approved contacts enabled</small></span><ChevronRight size={17}/></button>
          <button className="quick-action" onClick={() => (fakeCall?.stage === "scheduled" ? cancelFakeCall() : scheduleFakeCall())}><span className="quick-icon rose-soft"><PhoneIncoming size={18}/></span><span><b>{fakeCall?.stage === "scheduled" ? "Cancel fake call" : "Fake incoming call"}</b><small>{fakeCall?.stage === "scheduled" ? `Rings as ${fakeCall.callerName} in ${formatCountdown(fakeCall.at - nowTick)}` : `Rings as ${fakeCaller.trim() || "Mum"} ${Number(fakeDelay) > 0 ? `in ${fakeDelay} s` : "right away"} · set up in Fake call`}</small></span><ChevronRight size={17}/></button>
          <div className="quick-divider"/>
          <div className="location-status-row"><div className="location-status-icon"><LocateFixed size={16}/></div><div><b>Location status</b><small>{locationStatus === "available" ? `Available · ±${location?.accuracy} m accuracy` : locationStatus === "requesting" ? "Requesting permission…" : locationStatus === "unavailable" ? "Unavailable · no location shared" : "Not requested"}</small></div><StatusChip tone={locationStatus === "available" ? "success" : "neutral"}>{locationStatus === "available" ? "READY" : "OPTIONAL"}</StatusChip></div>
        </section>
      </div>
      <div className="section-heading"><div><div className="eyebrow">YOUR SAFETY NETWORK</div><h2>Trusted circle</h2></div><button className="text-btn" onClick={() => setPage("settings")}>Manage contacts <ArrowRight size={15}/></button></div>
      <div className="contact-grid">{contacts.filter(c=>c.enabled).slice(0,3).map(c => <div className="contact-card" key={c.id}><div className={`avatar ${c.color}`}>{c.initials}</div><div className="contact-info"><b>{c.name}</b><span>{c.relation}</span></div><span className="contact-approved"><Check size={13}/> Approved</span></div>)}
        <button className="add-contact-card" onClick={() => setPage("settings")}><span><Plus size={19}/></span><b>Add trusted contact</b></button>
      </div>
      <AgentStrip/>
      <div className="disclaimer"><AlertCircle size={15}/><span><b>Prototype notice:</b> Contact notifications and acknowledgements are simulated locally. Saathi does not contact emergency services. For immediate danger in India, call <a href="tel:112">112</a>.</span></div>
    </>
  );

  const IncidentPage = () => (
    <>
      <PageTitle eyebrow="LIVE RESPONSE" title="Incident coordination" subtitle="Every action has a status. Every status has a source." action={<StatusChip tone={active ? "danger" : incident?.status === "resolved" ? "success" : "neutral"}>{active ? "● ACTIVE INCIDENT" : incident?.status === "resolved" ? "RESOLVED" : "NO ACTIVE INCIDENT"}</StatusChip>}/>
      {!incident ? <div className="empty-state panel"><div className="empty-icon"><ShieldCheck size={28}/></div><h2>No active incident</h2><p>When you activate SOS, Saathi will coordinate your pre-authorized response here.</p><button className="btn btn-danger" onClick={() => startIncident("SOS button")}>Start demo SOS <ArrowRight size={16}/></button></div> :
      <>
        <div className="incident-overview panel">
          <div className="incident-main"><div className="incident-symbol"><Siren size={22}/></div><div><div className="eyebrow">INCIDENT ID · {incident.id}</div><h2>{incident.status === "active" ? "Safety session in progress" : "Incident resolved"}</h2><p>Started {new Date(incident.startedAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})} · Source: {incident.source}</p></div></div>
          <div className="incident-status"><StatusChip tone={incident.status === "active" ? "danger" : "success"}>{incident.status.toUpperCase()}</StatusChip><span>{incident.status === "active" ? "Monitoring acknowledgements" : `Closed ${incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}`}</span></div>
        </div>
        <div className={`server-link-banner ${serverBannerState === "connected" ? "connected" : "offline"}`}>
          <span className="server-link-dot"/>
          <div><b>{serverBannerState === "connected" ? "Mother Client is online" : serverBannerState === "partial" ? "Server online · Mother Client not connected" : "Communication server not connected"}</b>
          <small>{serverBannerState === "connected" ? "Room SAATHI-JIIT-DEMO · Real-time Socket.IO channel active" : serverBannerState === "partial" ? "Open the Mother Client (port 5174). Alerts are stored and shown when she connects." : "Start the server with `npm run server` to demonstrate live delivery."}</small></div>
          <StatusChip tone={serverBannerState === "connected" ? "success" : "warning"}>{serverBannerState === "connected" ? "ONLINE" : serverBannerState === "partial" ? "SERVER ONLY" : "OFFLINE"}</StatusChip>
        </div>
        <div className="incident-grid">
          <div className="panel response-panel">
            <div className="panel-heading"><div><div className="eyebrow">COORDINATION STATUS</div><h2>Trusted contacts</h2></div><Users size={19} className="muted-icon"/></div>
            <div className="contact-status-list">
              {contacts.filter(c => (incident.notified || []).includes(c.id)).map(c => {
                const ack = (incident.acknowledged || []).includes(c.id);
                return <div className="contact-status" key={c.id}><div className={`avatar ${c.color}`}>{c.initials}</div><div className="contact-info"><b>{c.name}</b><span>{c.relation}</span></div><div className="contact-state"><StatusChip tone={ack ? "success" : "warning"}>{ack ? "ACKNOWLEDGED" : "SENT · AWAITING"}</StatusChip><small>{ack ? "Response recorded" : "Awaiting response"}</small></div>{!ack && !c.live && <button className="btn btn-outline btn-xs" onClick={() => acknowledge(c.id)}>Mark received</button>}{!ack && c.live && <span className="live-wait">Waiting for their real response</span>}</div>;
              })}
              {!notifiedContacts.length && <div className="empty-inline">No contact alert has been sent. Check your trusted circle settings.</div>}
            </div>
            <div className="response-actions">
              <button className="btn btn-outline" onClick={() => escalate()} disabled={!active}><ArrowDownRight size={16}/> Run escalation step</button>
              <span className="helper-text">Skips the {escalationSeconds}s wait and alerts the next enabled contact now</span>
            </div>
            <div className="escalation-note"><Hourglass size={16}/><span><b>{escalationUi.headline}</b><small>{escalationUi.detail}</small></span>{escalationUi.remainingMs !== null && <strong className="escalation-timer">{formatCountdown(escalationUi.remainingMs)}</strong>}</div>
          </div>
          <div className="panel location-panel">
            <div className="panel-heading"><div><div className="eyebrow">LOCATION CONTEXT</div><h2>Shared location</h2></div><MapPin size={19} className="muted-icon"/></div>
            <MapView location={location} locationStatus={locationStatus} onLocate={getLocation} compact />
            <div className="location-meta"><span>Sharing state</span><b>{shareOnSOS && locationStatus === "available" ? "Attached to incident" : "Not shared"}</b></div>
            <div className="location-meta"><span>Battery (sent to Mother)</span><b>{batteryLabel(battery)}</b></div>
            <div className="location-meta"><span>Last captured</span><b>{location?.capturedAt ? new Date(location.capturedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}</b></div>
            <button className="btn btn-outline btn-block" onClick={getLocation}><LocateFixed size={15}/> Retrieve current location</button>
          </div>
        </div>
        <section className="panel family-chat-panel">
          <div className="panel-heading"><div><div className="eyebrow">TRUSTED CIRCLE · LIVE CHANNEL</div><h2>Conversation with Mother</h2></div><StatusChip tone={serverConnected && motherOnline ? "success" : "neutral"}>{!serverConnected ? "SERVER OFFLINE" : motherOnline ? "LIVE" : "MOTHER OFFLINE"}</StatusChip></div>
          <div className="family-chat-messages">
            {motherMessages.length === 0 ? <div className="chat-empty">Messages from the separate Mother Client will appear here.</div> : motherMessages.map((m, i) => <div className={`family-chat-bubble ${m.senderRole === "mother" ? "from-mother" : "from-user"}`} key={`${m.sentAt || i}-${i}`}><b>{m.senderName || (m.senderRole === "mother" ? "Mother" : "You")}</b><span>{m.text}</span><small>{m.sentAt ? new Date(m.sentAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "Now"}</small></div>)}
          </div>
          <div className="family-chat-compose"><input value={outgoingMessage} onChange={e => setOutgoingMessage(e.target.value)} placeholder="Send a message to Mother…" onKeyDown={e => { if (e.key === "Enter") sendMessageToMother(); }}/><button className="btn btn-primary btn-sm" onClick={sendMessageToMother} disabled={!outgoingMessage.trim() || !serverConnected}>Send</button></div>
          <p className="family-chat-note">{serverConnected && !motherOnline ? "Mother Client is offline. Messages are kept by the server and shown when she connects. " : ""}Demo communication only. Do not use this prototype as a real emergency messaging service.</p>
        </section>
        <div className="panel verification-panel">
          <div className="panel-heading"><div><div className="eyebrow">OUTCOME VERIFICATION</div><h2>What actually happened?</h2></div><ShieldCheck size={20} className="muted-icon"/></div>
          <div className="verification-grid">
            {[["Alert initiated","The local demo workflow created an alert event","success"],deliveryItem,["Acknowledgement",`${(incident.acknowledged || []).length} of ${(incident.notified || []).length} notified contacts acknowledged`,(incident.acknowledged || []).length ? "success" : "warning"],["Resolution",incident.status === "resolved" ? "User explicitly confirmed resolution" : "Waiting for user confirmation",incident.status === "resolved" ? "success" : "neutral"]].map((v,i)=><div className="verify-item" key={v[0]}><div className={`verify-dot ${v[2]}`}>{v[2] === "success" ? <Check size={13}/> : <Clock3 size={13}/>}</div><div><b>{v[0]}</b><span>{v[1]}</span></div></div>)}
          </div>
          {active && <div className="resolve-row"><div><b>Are you somewhere you feel safe?</b><span>Only you can confirm that this incident is resolved.</span></div><button className="btn btn-success" onClick={() => setShowResolve(true)}><CheckCircle2 size={16}/> Confirm I'm safe</button></div>}
          {incident.status === "resolved" && <div className="resolved-banner"><CheckCircle2 size={17}/> Resolution confirmed by user. Incident record retained locally.</div>}
        </div>
      </>}
    </>
  );

  const MapPage = () => (
    <>
      <PageTitle eyebrow="LOCATION & DESTINATIONS" title="Explore nearby options." subtitle="Find mapped public places and view a route to a destination you choose." action={<StatusChip tone={locationStatus === "available" ? "success" : "neutral"}>{locationStatus === "available" ? "LOCATION AVAILABLE" : "LOCATION NOT SHARED"}</StatusChip>}/>
      <div className="map-page-grid">
        <section className="panel map-page-panel">
          <div className="panel-heading"><div><div className="eyebrow">OPENSTREETMAP · LIVE MAP DATA</div><h2>Nearby public places</h2></div><button className="btn btn-outline btn-sm" onClick={getLocation}><LocateFixed size={14}/> Use my location</button></div>
          <MapView location={location} locationStatus={locationStatus} onLocate={getLocation} large />
        </section>
        <aside className="map-guidance">
          <div className="panel side-tip"><div className="tip-icon"><Compass size={19}/></div><h3>Choose your next step</h3><p>Select a mapped place to preview a walking route. You decide whether to use the suggestion.</p></div>
          <div className="panel side-tip"><div className="tip-icon violet-bg"><ShieldCheck size={18}/></div><h3>Important safety note</h3><p>A nearby place is not automatically safe, staffed, open, or accessible. Verify conditions yourself and contact someone you trust if needed.</p></div>
          <div className="panel side-tip"><div className="tip-icon"><Radio size={18}/></div><h3>Location privacy</h3><p>Your browser location is requested only after you tap the location control. This prototype does not track continuously.</p></div>
        </aside>
      </div>
      <div className="disclaimer"><AlertCircle size={15}/><span>Map tiles and nearby-place results require internet and may be incomplete or outdated. Routes are informational only, not safety-certified. For immediate danger in India, call <a href="tel:112">112</a>.</span></div>
    </>
  );

  const FakeCallPage = () => {
    const scheduled = fakeCall?.stage === "scheduled";
    return (
      <>
        <PageTitle eyebrow="DISCREET EXIT" title="Fake incoming call." subtitle="Make your phone ring so you have a natural reason to step away from an uncomfortable situation." action={<StatusChip tone={scheduled ? "warning" : "neutral"}>{scheduled ? "CALL SCHEDULED" : "NOT SCHEDULED"}</StatusChip>}/>
        <div className="assistant-layout">
          <section className="panel fakecall-setup">
            <div className="panel-heading"><div><div className="eyebrow">SET UP THE CALL</div><h2>Who is calling?</h2></div><PhoneIncoming size={19} className="muted-icon"/></div>
            <label className="field-label" htmlFor="fake-caller">Caller name shown on screen</label>
            <input id="fake-caller" className="text-field" value={fakeCaller} maxLength={30} onChange={e => setFakeCaller(e.target.value)} placeholder="Mum"/>
            <div className="fakecall-name-chips">{[...new Set([...contacts.map(c => c.name), "Papa", "Office"])].slice(0, 6).map(n => <button key={n} className={`map-filter-chip ${fakeCaller === n ? "active" : ""}`} onClick={() => setFakeCaller(n)}>{n}</button>)}</div>
            <label className="field-label" htmlFor="fake-delay">When should it ring?</label>
            <select id="fake-delay" className="text-field" value={fakeDelay} onChange={e => setFakeDelay(e.target.value)}>{FAKE_DELAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <div className="setting-row"><div><b>Play a ringtone</b><span>Sound starts when you tap the button below. Vibration is used on phones that support it.</span></div><label className="switch"><input type="checkbox" checked={fakeRing} onChange={e => setFakeRing(e.target.checked)}/><span/></label></div>
            {scheduled
              ? <div className="fakecall-scheduled"><Clock3 size={16}/><span>Ringing as <b>{fakeCall.callerName}</b> in <b>{formatCountdown(fakeCall.at - nowTick)}</b></span><button className="btn btn-outline btn-sm" onClick={cancelFakeCall}>Cancel</button></div>
              : <button className="btn btn-primary btn-block" onClick={() => scheduleFakeCall()}><PhoneIncoming size={16}/> {Number(fakeDelay) > 0 ? "Schedule fake call" : "Ring now"}</button>}
          </section>
          <aside className="assistant-side">
            <div className="panel side-tip"><div className="tip-icon"><ShieldCheck size={19}/></div><h3>What this does</h3><p>Shows a realistic incoming-call screen on this device. Nothing is dialled and nobody is contacted. Keep this tab open, and not muted, until the call arrives.</p></div>
            <div className="panel side-tip"><div className="tip-icon violet-bg"><AlertTriangle size={18}/></div><h3>In real danger?</h3><p>A fake call is for awkward moments. If you feel unsafe, use SOS or call <a href="tel:112">112</a>.</p></div>
          </aside>
        </div>
      </>
    );
  };

  const HistoryPage = () => {
    const stats = historyStats(history);
    const deliveryTone = (d) => (d === "delivered" ? "success" : d === "stored" ? "warning" : d === "failed" ? "danger" : "neutral");
    const deliveryText = (d) => (d === "delivered" ? "Delivered live" : d === "stored" ? "Stored, Mother offline" : d === "failed" ? "Delivery failed" : "Simulated only");
    return (
      <>
        <PageTitle eyebrow="PAST SESSIONS" title="Incident history" subtitle="Every resolved safety session, kept on this device, with what really happened." action={history.length > 0 && <button className="btn btn-outline btn-sm" onClick={() => { if (confirm("Delete all incident history from this browser?")) { setHistory([]); setExpandedId(null); setToast("Incident history cleared."); } }}><Trash2 size={14}/> Clear history</button>}/>
        <div className="timeline-summary-grid">
          <div className="panel metric-card"><span>Sessions recorded</span><strong>{stats.total}</strong><small>Resolved by you</small></div>
          <div className="panel metric-card"><span>Average first response</span><strong>{stats.avgResponseMs === null ? "—" : formatDuration(stats.avgResponseMs)}</strong><small>{stats.answered} of {stats.total} were acknowledged</small></div>
          <div className="panel metric-card"><span>Needed escalation</span><strong>{stats.escalated}</strong><small>Next contact was alerted</small></div>
        </div>
        {active && <div className="active-banner"><div className="active-banner-icon"><Radio size={19}/></div><div><b>A session is active right now</b><span>It will appear here once you confirm you are safe.</span></div><button className="btn btn-dark btn-sm" onClick={() => setPage("incident")}>Open <ArrowRight size={15}/></button></div>}
        {history.length === 0 ? <div className="empty-state panel"><div className="empty-icon"><HistoryIcon size={28}/></div><h2>No past incidents yet</h2><p>When you resolve a safety session it is saved here with its timeline, who was alerted and how fast they responded.</p></div> :
        <div className="history-list">{history.map(r => {
          const open = expandedId === r.id;
          return <section className="panel history-card" key={r.id}>
            <button className="history-head" onClick={() => setExpandedId(open ? null : r.id)} aria-expanded={open}>
              <div className="history-head-main"><div className="eyebrow">{r.id}</div><b>{new Date(r.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</b><span>{r.source} · lasted {formatDuration(r.durationMs)}</span></div>
              <div className="history-chips"><StatusChip tone={deliveryTone(r.delivery)}>{deliveryText(r.delivery)}</StatusChip>{r.escalated && <StatusChip tone="warning">ESCALATED</StatusChip>}<StatusChip tone={Number.isFinite(r.firstResponseMs) ? "success" : "neutral"}>{Number.isFinite(r.firstResponseMs) ? `ACK ${formatDuration(r.firstResponseMs)}` : "NO ACK"}</StatusChip></div>
              <ChevronDown size={18} className={`history-chevron ${open ? "open" : ""}`}/>
            </button>
            {open && <div className="history-body">
              <p className="history-message">“{r.message || "—"}”</p>
              <div className="history-facts">
                <div><span>Location attached</span><b>{r.locationAttached ? "Yes" : "No"}</b></div>
                <div><span>Battery at start</span><b>{r.battery ? `${r.battery.level}%${r.battery.charging ? " · charging" : ""}` : "Not available"}</b></div>
                <div><span>Contacts alerted</span><b>{r.notified.length}</b></div>
              </div>
              <div className="eyebrow">WHO WAS ALERTED</div>
              <div className="history-contacts">{r.notified.length ? r.notified.map(n => <div key={n.id}><b>{n.name}</b><span>{n.live ? "Live link" : "Simulated"}</span><StatusChip tone={n.acknowledged ? "success" : "neutral"}>{n.acknowledged ? `ACKNOWLEDGED${Number.isFinite(n.responseMs) ? ` · ${formatDuration(n.responseMs)}` : ""}` : "NO ACKNOWLEDGEMENT"}</StatusChip></div>) : <p className="muted-small">No contact was alerted.</p>}</div>
              <div className="eyebrow">TIMELINE</div>
              <div className="history-timeline">{r.events.map((e, i) => <div key={i}><span className="history-time">{e.time}</span><div><b>{e.title}</b><p>{e.detail}</p></div></div>)}</div>
              <div className="history-actions">
                <button className="btn btn-outline btn-sm" onClick={() => { saveTextFile(`saathi-incident-${r.id}.txt`, incidentReportText(r)); setToast("Incident report downloaded."); }}><Download size={14}/> Download report</button>
                <button className="btn btn-quiet btn-sm" onClick={() => { setHistory(prev => prev.filter(h => h.id !== r.id)); setExpandedId(null); setToast("Incident removed from history."); }}><Trash2 size={14}/> Delete</button>
              </div>
            </div>}
          </section>;
        })}</div>}
        <div className="disclaimer"><AlertCircle size={15}/><span>History is stored only in this browser. Acknowledgement times come from the Mother Client over the server; other contacts are simulated and are labelled that way.</span></div>
      </>
    );
  };

  const AgentCenterPage = () => {
    const awaitingContact = contacts.find(c => !c.live && (incident?.notified || []).includes(c.id) && !(incident?.acknowledged || []).includes(c.id));
    const awaitingLive = contacts.find(c => c.live && (incident?.notified || []).includes(c.id) && !(incident?.acknowledged || []).includes(c.id));
    const incEvents = events.filter(e => incident && e.incidentId === incident.id);
    const firstNotified = contacts.find(c => (incident?.notified || []).includes(c.id));
    const hasIntent = incEvents.some(e => e.title === "Intent Agent");
    const hasPlan = incEvents.some(e => e.title === "Safety Planner");
    const hasCoordination = incEvents.some(e => e.title === "Coordination Agent" || e.title.startsWith("Alert sent") || e.title.startsWith("Escalated to"));
    const hasVerification = incEvents.some(e => e.title === "Verification Agent");
    const agents = [
      { n: "01", name: "Intent Agent", role: "Understand the request", detail: incident ? `Classified as ${incident.intent || "distress"} from the user's message.` : "Waiting for a distress request or SOS activation.", done: hasIntent, icon: MessageCircle, color: "rose" },
      { n: "02", name: "Safety Planner", role: "Create a permitted plan", detail: incident ? "Prepared the pre-authorized workflow and checked available context." : "Will prepare actions after an incident starts.", done: hasPlan, icon: Compass, color: "violet" },
      { n: "03", name: "Coordination Agent", role: "Execute approved actions", detail: incident ? `${(incident.notified || []).length} contact(s) recorded as notified in this local demo.` : "No contact actions have been executed.", done: hasCoordination, icon: Users, color: "teal" },
      { n: "04", name: "Verification Agent", role: "Verify tool outcomes", detail: incident ? "Checks local state changes and keeps simulated delivery separate from acknowledgement." : "Will verify each recorded action result.", done: hasVerification, icon: CheckCheck, color: "amber" }
    ];
    return (
      <>
        <PageTitle eyebrow="AGENT ORCHESTRATION" title="Saathi Agent Center." subtitle="A policy-controlled workflow: understand, plan, coordinate and verify." action={<StatusChip tone={active ? "warning" : "success"}>{active ? "WORKFLOW ACTIVE" : "READY TO DEMONSTRATE"}</StatusChip>}/>
        <div className="agent-center-hero panel">
          <div className="agent-center-hero-copy">
            <div className="eyebrow">MULTI-AGENT COORDINATION ENGINE</div>
            <h2>{active ? "Your workflow is in progress." : "See how Saathi coordinates help."}</h2>
            <p>{active ? `Incident ${incident.id} · ${incident.message}` : "Run a controlled demonstration to see the four agents create an incident, apply policy, record contact actions and verify outcomes."}</p>
            <div className="agent-center-actions">
              {!active ? <button className="btn btn-primary" onClick={runAgentDemo}><Zap size={16}/> Run controlled demo <ArrowRight size={15}/></button> : <button className="btn btn-outline" onClick={() => setPage("incident")}>Open live incident <ArrowRight size={15}/></button>}
              <button className="btn btn-quiet" onClick={() => setPage("timeline")}><Activity size={15}/> View audit log</button>
            </div>
          </div>
          <div className="agent-center-orb"><BrainCircuit size={42}/><span>POLICY<br/>ENGINE</span></div>
        </div>
        <div className="agent-center-grid">
          {agents.map((agent, i) => {
            const Icon = agent.icon;
            return <section className={`panel agent-detail-card ${agent.done ? "agent-done" : ""}`} key={agent.n}>
              <div className="agent-detail-top"><div className={`agent-detail-icon ${agent.color}`}><Icon size={19}/></div><StatusChip tone={agent.done ? "success" : "neutral"}>{agent.done ? "EXECUTED" : "STANDBY"}</StatusChip></div>
              <div className="eyebrow">AGENT {agent.n}</div><h3>{agent.name}</h3><b>{agent.role}</b><p>{agent.detail}</p>
              <div className="agent-detail-foot"><span>{agent.done ? "Local event recorded" : "Awaiting workflow"}</span>{agent.done ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>}</div>
            </section>;
          })}
        </div>
        <div className="agent-center-lower">
          <section className="panel agent-execution-panel">
            <div className="panel-heading"><div><div className="eyebrow">EXECUTION CONTROLS</div><h2>Coordinator actions</h2></div><ShieldCheck size={19} className="muted-icon"/></div>
            {!active ? <div className="empty-state compact"><div className="empty-icon"><BrainCircuit size={24}/></div><h3>No active workflow</h3><p>Run the controlled demo to enable contact coordination and verification controls.</p></div> : <>
              <div className="agent-execution-row"><div><b>Contact acknowledgement</b><span>{awaitingContact ? `${awaitingContact.name} is awaiting a demo response.` : awaitingLive ? `${awaitingLive.name} must acknowledge from the real Mother Client.` : "No notified contact is currently awaiting acknowledgement."}</span></div><button className="btn btn-outline btn-sm" disabled={!awaitingContact} onClick={() => acknowledge(awaitingContact.id)}>Mark received</button></div>
              <div className="agent-execution-row"><div><b>Authorized escalation</b><span>Uses the next enabled contact only when no notified contact has acknowledged and escalation is enabled.</span></div><button className="btn btn-outline btn-sm" onClick={() => escalate()} disabled={!autoEscalate}>Run escalation</button></div>
              <div className="agent-execution-row"><div><b>Policy configuration</b><span>Escalation permission is {autoEscalate ? "enabled" : "disabled"} in Preferences.</span></div><button className="btn btn-quiet btn-sm" onClick={() => setPage("settings")}>Review policy</button></div>
              <div className="agent-policy-note"><LockKeyhole size={15}/> The policy engine, not the language model, controls whether an action is allowed. All contact actions here are simulated locally.</div>
            </>}
          </section>
          <section className="panel agent-event-panel">
            <div className="panel-heading"><div><div className="eyebrow">RECENT AGENT EVENTS</div><h2>What the system recorded</h2></div><button className="btn btn-quiet btn-sm" onClick={() => setPage("timeline")}>Full log <ArrowRight size={13}/></button></div>
            {events.filter(e => e.type === "agent" || e.title.includes("Policy Engine")).slice(0,5).length ? <div className="agent-event-list">{events.filter(e => e.type === "agent" || e.title.includes("Policy Engine")).slice(0,5).map(e => <div className="agent-event-item" key={e.id}><span className="agent-event-dot"/><div><b>{e.title}</b><p>{e.detail}</p><small>{e.time} · {e.status}</small></div></div>)}</div> : <div className="empty-state compact"><p>Agent events will appear here after a workflow starts.</p></div>}
          </section>
        </div>
        <div className="disclaimer"><AlertCircle size={15}/><span>Prototype transparency: agent roles are implemented as a deterministic local workflow and rule-based intent classifier. No external LLM, real SMS delivery, or emergency-service dispatch is connected. Demo acknowledgements are not real contact responses.</span></div>
      </>
    );
  };

  const AssistantPage = () => (
    <>
      <PageTitle eyebrow="NATURAL LANGUAGE SUPPORT" title="Talk to Saathi." subtitle="Say what you need in your own words. You stay in control of every action."/>
      <div className="assistant-layout">
        <section className="panel assistant-main">
          <div className="assistant-welcome"><div className="assistant-orb"><Sparkles size={24}/></div><div><div className="eyebrow">SAATHI ASSISTANT</div><h2>How can I help you feel safer?</h2><p>English and Hindi phrases are supported in this prototype.</p></div></div>
          <div className="suggestion-list"><span className="eyebrow">TRY SAYING</span><div className="suggestions">
            {["I feel unsafe, help me get home.","Mummy ko meri location bhejo.","Start a journey check-in.","I need someone to call me."].map(s=><button key={s} className="suggestion-chip" onClick={() => setMessage(s)}>{s}<ArrowUpRightIcon/></button>)}
          </div></div>
          <div className="chat-input-wrap"><textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Type a message… e.g. I feel someone is following me." rows={3} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAssistant();}}}/><div className="chat-input-bottom"><span><LockKeyhole size={12}/> Your request is processed in this local demo.</span><div><button className="icon-btn" title="Voice input is a future integration" onClick={()=>setToast("Voice input is not connected in this prototype. Use text or SOS.")}><Mic size={17}/></button><button className="btn btn-primary" onClick={sendAssistant} disabled={!message.trim()}>Analyze request <ArrowRight size={15}/></button></div></div></div>
          {assistantReply && <div className="intent-result">
            <div className="intent-result-head"><div><div className="eyebrow">INTENT AGENT · CLASSIFICATION</div><h3>{assistantReply.label}</h3></div><StatusChip tone={assistantReply.urgency==="High"?"danger":assistantReply.urgency==="Medium"?"warning":"success"}>{assistantReply.urgency} urgency</StatusChip></div>
            <div className="confidence-row"><span>Method</span><b>Keyword rules · no ML</b></div><div className="signal-row">{assistantReply.matched.length ? assistantReply.matched.map(m => <span className="signal-chip" key={m}>{m}</span>) : <span className="signal-none">No specific keywords matched</span>}</div>
            <div className="eyebrow plan-label">PROPOSED ACTIONS</div><div className="proposed-actions">{assistantReply.actions.map((a,i)=><div key={a}><span>{i+1}</span>{a}</div>)}</div>
            <div className="consent-note"><ShieldCheck size={16}/> AI suggests; the deterministic policy engine controls execution. No action is taken without the required permission.</div>
            <button className="btn btn-primary btn-block" onClick={runAssistantAction}>Continue with this plan <ArrowRight size={16}/></button>
          </div>}
        </section>
        <aside className="assistant-side">
          <div className="panel side-tip"><div className="tip-icon"><ShieldCheck size={19}/></div><h3>Safety comes first</h3><p>If you're in immediate danger in India, call 112. Don't wait for an AI response.</p><a href="tel:112" className="btn btn-outline btn-block"><Phone size={15}/> Call emergency number 112</a></div>
          <div className="panel side-tip"><div className="tip-icon violet-bg"><LockKeyhole size={18}/></div><h3>You are in control</h3><p>Saathi never decides whether an emergency is genuine. Explicit SOS follows your pre-configured workflow.</p></div>
        </aside>
      </div>
    </>
  );

  const TimelinePage = () => (
    <>
      <PageTitle eyebrow="AUDIT & VERIFICATION" title="Activity timeline" subtitle="A transparent record of requests, actions, tool results and user confirmations." action={<div className="heading-actions-row"><button className="btn btn-outline btn-sm" onClick={copyLog}><Copy size={14}/> Copy log</button><button className="btn btn-outline btn-sm" onClick={downloadLog}><Download size={14}/> Download .txt</button></div>}/>
      <div className="timeline-summary-grid"><div className="panel metric-card"><span>Total events</span><strong>{events.length}</strong><small>Recorded locally</small></div><div className="panel metric-card"><span>Current incident</span><strong>{incident ? incident.id : "—"}</strong><small>{incident?.status || "No incident yet"}</small></div><div className="panel metric-card"><span>Contacts acknowledged</span><strong>{incident?.acknowledged?.length || 0}</strong><small>Demo acknowledgements</small></div></div>
      <div className="panel timeline-panel"><div className="panel-heading"><div><div className="eyebrow">EVENT LOG</div><h2>Latest activity</h2></div><StatusChip tone="success">PERSISTENT ON DEVICE</StatusChip></div>
        {events.length ? <div className="timeline-list">{events.map((e,i)=><div className="timeline-event" key={e.id}><div className={`timeline-icon ${e.type}`}>{e.type==="success"?<Check size={15}/>:e.type==="danger"?<Siren size={15}/>:e.type==="warning"?<AlertTriangle size={15}/>:e.type==="agent"?<Sparkles size={15}/>:<Activity size={15}/>}</div><div className="timeline-event-body"><div className="timeline-event-top"><b>{e.title}</b><span>{e.time}</span></div><p>{e.detail}</p><div className="event-meta"><StatusChip tone={e.status==="failed"?"danger":e.status==="simulated"?"warning":e.status==="pending"?"neutral":"success"}>{e.status}</StatusChip><span>{e.date}</span></div></div></div>)}</div> : <div className="empty-state compact"><div className="empty-icon"><Activity size={25}/></div><h3>No events yet</h3><p>Start a demo safety session or try the assistant to create your first audit events.</p><button className="btn btn-primary" onClick={()=>startIncident("SOS button")}>Create demo incident</button></div>}
      </div>
      <div className="disclaimer"><AlertCircle size={15}/><span>Event statuses are deliberately separated: <b>sent</b> is not the same as delivered, acknowledged, or resolved. Prototype notifications are simulated.</span></div>
    </>
  );

  const SettingsPage = () => (
    <>
      <PageTitle eyebrow="PERSONAL CONTROL CENTER" title="Your safety preferences." subtitle="Configure who can be contacted and what Saathi is allowed to do."/>
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">TRUSTED CIRCLE</div><h2>People you trust</h2><p className="panel-subtitle">Only enabled contacts are eligible for demo alert workflows.</p></div><Users size={19} className="muted-icon"/></div>
            <div className="settings-contact-list">{contacts.map(c=><div className="settings-contact" key={c.id}><div className={`avatar ${c.color}`}>{c.initials}</div><div className="contact-info"><b>{c.name}</b><span>{c.relation} · {c.phone}</span></div>{c.live ? <StatusChip tone="success">LIVE LINK</StatusChip> : <button className="text-btn" title="Connect the Mother Client app to this contact" onClick={()=>{setContacts(prev=>prev.map(x=>({...x,live:x.id===c.id})));setToast(`${c.name} is now the live-link contact.`);}}>Set live</button>}<label className="switch"><input type="checkbox" checked={c.enabled} onChange={e=>setContacts(prev=>prev.map(x=>x.id===c.id?{...x,enabled:e.target.checked}:x))}/><span/></label><button className="icon-btn delete-btn" title="Remove contact" onClick={()=>setContacts(prev=>prev.filter(x=>x.id!==c.id))}><Trash2 size={15}/></button></div>)}</div>
            <div className="add-contact-form"><div className="eyebrow">ADD A CONTACT</div><div className="form-row"><input value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Contact name"/><input value={contactPhone} onChange={e=>setContactPhone(e.target.value)} placeholder="Phone number"/></div><button className="btn btn-outline btn-sm" onClick={()=>{if(!contactName.trim()||!contactPhone.trim()){setToast("Enter a name and phone number.");return;}const initials=contactName.trim().split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();setContacts(p=>[...p,{id:Date.now(),name:contactName.trim(),phone:contactPhone.trim(),relation:"Trusted contact",initials,color:"blue",enabled:true}]);setContactName("");setContactPhone("");setToast("Trusted contact added to this device.");}}><Plus size={14}/> Add trusted contact</button></div>
          </section>
          <section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">RESPONSE RULES</div><h2>Escalation policy</h2><p className="panel-subtitle">Pre-authorize the next step. A missed acknowledgement is not proof of danger.</p></div><Zap size={19} className="muted-icon"/></div>
            <div className="setting-row"><div><b>Escalation wait window</b><span>Time before the next demo escalation step</span></div><select value={escalationSeconds} onChange={e=>setEscalationSeconds(e.target.value)}><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">2 minutes</option></select></div>
            <div className="setting-row"><div><b>Allow escalation workflow</b><span>Use the next enabled contact if no acknowledgement arrives</span></div><label className="switch"><input type="checkbox" checked={autoEscalate} onChange={e=>setAutoEscalate(e.target.checked)}/><span/></label></div>
            <div className="setting-row"><div><b>Attach available location on SOS</b><span>Needs browser permission. A fix older than 5 minutes is never sent</span></div><label className="switch"><input type="checkbox" checked={shareOnSOS} onChange={e=>setShareOnSOS(e.target.checked)}/><span/></label></div>
            <div className="setting-row"><div><b>Share live location updates during an incident</b><span>About every 10 seconds, to your live-link contact only, until you confirm you are safe</span></div><label className="switch"><input type="checkbox" checked={liveLocation} disabled={!shareOnSOS} onChange={e=>setLiveLocation(e.target.checked)}/><span/></label></div>
            <div className="setting-row"><div><b>Journey check-in reminder</b><span>Expected arrival/check-in interval</span></div><select value={checkinMinutes} onChange={e=>setCheckinMinutes(e.target.value)}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></div>
          </section>
        </div>
        <aside className="settings-side">
          <div className="panel privacy-card"><div className="privacy-icon"><LockKeyhole size={20}/></div><h3>Privacy by default</h3><ul><li><Check size={14}/> Location is permission-based</li><li><Check size={14}/> Sharing is visible and revocable</li><li><Check size={14}/> Data stays here unless your live-link contact is alerted</li><li><Check size={14}/> No hidden tracking</li></ul></div>
          <div className="panel danger-zone"><div className="eyebrow">DATA CONTROLS</div><h3>Reset prototype data</h3><p>Remove locally stored contacts, incidents and event history from this browser.</p><button className="btn btn-outline btn-block" onClick={()=>{if(confirm("Delete all Saathi prototype data from this browser?")){localStorage.removeItem(STORAGE_KEY);setContacts(initialContacts);setIncident(null);setEvents([]);setLocation(null);setLocationStatus("not-shared");setJourneyActive(false);setJourneyEndsAt(null);setLiveLocation(false);setMotherMessages([]);setHistory([]);setExpandedId(null);setFakeCall(null);setToast("Local prototype data reset.");}}}><Trash2 size={14}/> Reset local data</button></div>
        </aside>
      </div>
    </>
  );

  const SummaryPage = () => (
    <>
      <PageTitle eyebrow="INCIDENT REPORT" title="A clear record of what happened." subtitle="Review the actions and outcomes recorded during your safety session." action={<button className="btn btn-outline btn-sm" onClick={()=>setPage("timeline")}><Activity size={15}/> Full timeline</button>}/>
      {incident ? <div className="summary-layout"><div className="panel summary-hero"><div className="summary-check"><Check size={26}/></div><div className="eyebrow">USER-CONFIRMED RESOLUTION</div><h2>{incident.status==="resolved"?"You marked this session as resolved.":"This session is not yet resolved."}</h2><p>Incident {incident.id} · Started {new Date(incident.startedAt).toLocaleString()}</p><StatusChip tone={incident.status==="resolved"?"success":"warning"}>{incident.status.toUpperCase()}</StatusChip></div><div className="panel summary-details"><h2>Outcome breakdown</h2>{[["Contacts notified",(incident.notified||[]).length],["Acknowledgements received",(incident.acknowledged||[]).length],["Escalation used",incident.escalated?"Yes":"No"],["Location attached",shareOnSOS&&locationStatus==="available"?"Available at incident start":"Not confirmed"],["Resolution",incident.resolvedAt?new Date(incident.resolvedAt).toLocaleString():"Pending"]].map(x=><div className="summary-detail-row" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>)}<div className="summary-caution"><AlertCircle size={15}/> A contact notification or acknowledgement in this prototype is simulated. It does not prove that real-world assistance was provided.</div><button className="btn btn-outline btn-block" onClick={()=>setPage("history")}>View in incident history <ArrowRight size={15}/></button><button className="btn btn-primary btn-block" onClick={()=>setPage("home")}>Back to overview <ArrowRight size={15}/></button></div></div> : <div className="empty-state panel"><h2>No incident summary yet</h2><button className="btn btn-primary" onClick={()=>setPage("home")}>Go to overview</button></div>}
    </>
  );

  return (
    <div className="app-shell">
      {Sidebar()}
      {mobileMenu && <div className="mobile-scrim" onClick={()=>setMobileMenu(false)}/>}
      <main className="main-area">{Header()}<div className="page-content">
        {page==="home"&&HomePage()}
        {page==="incident"&&IncidentPage()}
        {page==="map"&&MapPage()}
        {page==="agents"&&AgentCenterPage()}
        {page==="assistant"&&AssistantPage()}
        {page==="timeline"&&TimelinePage()}
        {page==="fakecall"&&FakeCallPage()}
        {page==="helplines"&&<><PageTitle eyebrow="QUICK HELP" title="Emergency helplines." subtitle="Tap to call or copy any national helpline number. For immediate danger, call 112."/><Helplines onCopied={setToast}/></>}
        {page==="history"&&HistoryPage()}
        {page==="settings"&&SettingsPage()}
        {page==="summary"&&SummaryPage()}
      </div><footer className="app-footer"><span>© 2026 Saathi Prototype</span><span><LockKeyhole size={12}/> Consent-led · Transparent · User-controlled</span></footer></main>
      {fakeCall && (fakeCall.stage === "ringing" || fakeCall.stage === "connected") && <FakeCall call={fakeCall} ringtone={fakeRing} onAnswer={answerFakeCall} onEnd={endFakeCall}/>}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={17}/>{toast}<button onClick={()=>setToast("")}><X size={14}/></button></div>}
      {showResolve && <div className="modal-backdrop"><div className="confirm-modal"><div className="modal-icon"><ShieldCheck size={24}/></div><button className="modal-close icon-btn" onClick={()=>setShowResolve(false)}><X size={18}/></button><div className="eyebrow">CONFIRM RESOLUTION</div><h2>Are you somewhere you feel safe?</h2><p>Saathi will close this incident only because you confirm it. This does not mean every action was successful.</p><div className="modal-actions"><button className="btn btn-outline" onClick={()=>setShowResolve(false)}>Not yet</button><button className="btn btn-success" onClick={resolveIncident}><Check size={15}/> Yes, I'm safe</button></div></div></div>}
      {journeyDue && !showResolve && <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="journey-title"><div className="confirm-modal"><div className="modal-icon"><Timer size={24}/></div><div className="eyebrow">JOURNEY CHECK-IN</div><h2 id="journey-title">Check-in time. Are you safe?</h2><p>Your journey check-in has ended. A missed check-in never starts SOS by itself; you decide what happens next.</p><div className="modal-actions modal-actions-wrap"><button className="btn btn-outline" onClick={extendJourney}>Add 15 min</button><button className="btn btn-success" onClick={() => endJourney("Glad you are safe. Check-in ended.")}><Check size={15}/> I'm safe</button><button className="btn btn-danger" onClick={() => { endJourney("Check-in ended. Starting SOS."); startIncident("Journey check-in", "I feel unsafe. My journey check-in is due and I need help."); }}><Siren size={15}/> Start SOS</button></div></div></div>}
    </div>
  );
}

export default App;