import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ShieldCheck, BellRing, MapPin, Clock3, CheckCircle2, Phone, Send, Wifi, WifiOff, HeartHandshake, MessageCircle, Siren, ArrowUpRight, Activity, Volume2, BatteryLow, BatteryMedium, BatteryFull, BatteryCharging, Smartphone } from "lucide-react";
import "./mother-extras.css";

// Same host the page was opened from, so opening http://LAPTOP-IP:5174 on a phone just works.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
const ROOM = "SAATHI-JIIT-DEMO";
const QUICK_REPLIES = ["I'm calling you now", "I'm on my way", "Stay somewhere well-lit and public", "I've called 112"];

const mergeMessages = (prev, incoming) => {
  const seen = new Set(prev.map(m => m.id).filter(Boolean));
  const next = [...prev];
  for (const m of incoming) { if (m.id && seen.has(m.id)) continue; if (m.id) seen.add(m.id); next.push(m); }
  return next.slice(-100);
};
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now");

function BatteryIcon({ battery }) {
  if (!battery) return <BatteryMedium size={16}/>;
  if (battery.charging) return <BatteryCharging size={16}/>;
  if (battery.level <= 15) return <BatteryLow size={16}/>;
  return battery.level >= 80 ? <BatteryFull size={16}/> : <BatteryMedium size={16}/>;
}

export default function MotherApp() {
  const [connected, setConnected] = useState(false);
  const [incident, setIncident] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [events, setEvents] = useState([]);
  const [womanOnline, setWomanOnline] = useState(false);
  const [womanLastSeen, setWomanLastSeen] = useState(null);
  const [alertsOn, setAlertsOn] = useState(false);
  const [notice, setNotice] = useState("");
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const endRef = useRef(null);

  const addLocalEvent = (label) => setEvents(prev => [{ id: Date.now() + Math.random(), label, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...prev].slice(0, 8));

  // Alert effects need a user gesture first (browser rule), hence the "Enable alerts" button.
  const beep = () => {
    const ctx = audioRef.current;
    if (!ctx) return;
    [0, 0.35, 0.7].forEach(offset => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = 880; gain.gain.value = 0.12;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.2);
    });
  };
  const alertUser = (data) => {
    beep();
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification("Saathi SOS alert", { body: data.message || "A safety alert has been initiated.", tag: data.incidentId }); } catch {}
    }
  };
  const enableAlerts = () => {
    try {
      audioRef.current = audioRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current.resume?.();
      beep();
    } catch {}
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    setAlertsOn(true);
  };

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket", "polling"], reconnection: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", { room: ROOM, role: "mother", displayName: "Mother" });
      addLocalEvent("Connected to communication server");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    // Rebuilds the view after a refresh or reconnect: current incident, chat history, presence.
    socket.on("state:sync", (s) => {
      setWomanOnline(Boolean(s?.presence?.woman));
      setWomanLastSeen(s?.womanLastSeenAt || null);
      setIncident(s?.incident || null);
      setAcknowledged(Boolean(s?.acknowledged));
      if (Array.isArray(s?.messages)) setMessages(prev => mergeMessages(prev, s.messages));
    });
    socket.on("incident:alert", (data) => {
      setIncident({ ...data, resolved: false });
      setAcknowledged(false);
      addLocalEvent(`New SOS received · ${data.incidentId}`);
      alertUser(data);
    });
    socket.on("location:update", (d) => {
      setIncident(prev => (prev && prev.incidentId === d.incidentId ? { ...prev, location: d.location, locationUpdatedAt: d.receivedAt } : prev));
    });
    socket.on("device:update", (d) => {
      setIncident(prev => (prev && prev.incidentId === d.incidentId ? { ...prev, device: d.device, deviceUpdatedAt: d.receivedAt } : prev));
    });
    socket.on("incident:escalation", (d) => addLocalEvent(`Escalation update · ${d.contactName || "Additional contact"}`));
    socket.on("incident:resolved", (d) => {
      setIncident(prev => (prev && prev.incidentId === d.incidentId ? { ...prev, resolved: true } : prev));
      addLocalEvent("Saathi user marked themselves safe");
    });
    socket.on("chat:message", (m) => {
      setMessages(prev => mergeMessages(prev, [m]));
      if (m.senderRole === "woman") addLocalEvent("Message received from Saathi user");
    });
    socket.on("presence:update", (d) => {
      if (d.role !== "woman") return;
      setWomanOnline(d.status === "online");
      if (d.status === "offline") { setWomanLastSeen(d.at || new Date().toISOString()); addLocalEvent("Saathi user went offline"); }
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const live = Boolean(incident && !incident.resolved);
  useEffect(() => {
    document.title = live && !acknowledged ? "SOS ALERT · Saathi" : "Saathi · Trusted Circle";
  }, [live, acknowledged]);

  const acknowledge = () => {
    if (!live || !connected || acknowledged) return;
    // Only mark as sent once the server confirms; otherwise the user would believe it arrived.
    socketRef.current.timeout(5000).emit("incident:acknowledge", {
      incidentId: incident.incidentId, message: "I have received your alert and I am responding."
    }, (err, res) => {
      if (err || !res?.ok) { setNotice(res?.error || "Could not confirm delivery of your acknowledgement. Please try again."); return; }
      setNotice("");
      setAcknowledged(true);
      addLocalEvent("Acknowledgement sent to Saathi user");
    });
  };

  const sendMessage = (value = text) => {
    const body = value.trim();
    if (!body || !connected) return;
    socketRef.current.timeout(5000).emit("chat:send", { incidentId: incident?.incidentId || null, text: body }, (err, res) => {
      if (err || !res?.ok) setNotice("Your message was not confirmed by the server. Please try again.");
    });
    setText("");
  };

  const time = incident?.receivedAt ? clock(incident.receivedAt) : "—";
  const loc = incident?.location;
  const presence = !connected ? "Cannot reach the server. Check that it is running." : womanOnline ? "Saathi user is online" : "Connected · Saathi user is not online right now";

  return <div className="mother-app">
    <header className="mother-topbar">
      <div className="mother-brand"><div className="mother-logo"><ShieldCheck size={22}/></div><div><b>saathi<span>.</span></b><small>TRUSTED CIRCLE</small></div></div>
      <div className={`connection-pill ${connected ? "online" : "offline"}`}>{connected ? <Wifi size={14}/> : <WifiOff size={14}/>} {connected ? "Server connected" : "Offline"}</div>
    </header>
    <main className="mother-main">
      <section className="welcome-row"><div><div className="overline">FAMILY RESPONSE PORTAL</div><h1>You're connected.</h1><p>Receive safety alerts and respond directly to your loved one.</p></div><div className="mother-avatar">M</div></section>
      <div className={`presence-card ${connected && womanOnline ? "present" : ""}`}><span className="presence-dot"/><span>{presence}</span><span className="room-label">ROOM · {ROOM}</span></div>
      {!alertsOn && <button className="alerts-toggle" onClick={enableAlerts}><Volume2 size={16}/> Enable alert sound and notifications</button>}
      {notice && <div className="notice-bar" role="alert">{notice}</div>}

      {incident?.resolved && <section className="resolved-card"><CheckCircle2 size={22}/><div><b>The Saathi user marked themselves safe.</b><small>Incident {incident.incidentId} is closed. You can still send a message.</small></div></section>}

      {live ? <section className="alert-card">
        <div className="alert-card-head"><div className="alert-icon"><Siren size={23}/></div><div><div className="overline danger-text">INCOMING SAFETY ALERT</div><h2>Saathi needs your attention</h2><small>Received at {time} · {incident.incidentId}</small></div><span className="live-tag">LIVE</span></div>
        <div className="alert-message">{incident.message || "A safety alert has been initiated."}</div>
        <div className="alert-facts">
          <div><Clock3 size={16}/><span><b>Incident started</b><small>{incident.startedAt ? new Date(incident.startedAt).toLocaleString() : "Time unavailable"}</small></span></div>
          <div><MapPin size={16}/><span><b>Location information</b><small>{loc ? `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)} · ±${loc.accuracy || "?"} m${incident.locationUpdatedAt ? ` · updated ${clock(incident.locationUpdatedAt)}` : ""}` : "Not shared yet, or unavailable"}</small></span></div>
        </div>
        <div className="alert-facts alert-facts-device">
          <div><BatteryIcon battery={incident.device?.battery}/><span><b>Phone battery</b><small>{incident.device?.battery ? `${incident.device.battery.level}%${incident.device.battery.charging ? " · charging" : ""}${incident.deviceUpdatedAt ? ` · updated ${clock(incident.deviceUpdatedAt)}` : ""}` : "Not reported by their browser"}</small>{incident.device?.battery && !incident.device.battery.charging && incident.device.battery.level <= 15 && <em className="low-battery-flag">Battery is low. Their phone may switch off soon.</em>}</span></div>
          <div><Smartphone size={16}/><span><b>Their connection</b><small>{womanOnline ? "Online now" : womanLastSeen ? `Offline since ${clock(womanLastSeen)}. Last shared location above is the last known one.` : "Offline"}</small></span></div>
        </div>
        {loc && <a className="map-link" href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer"><MapPin size={15}/> Open shared coordinates in map <ArrowUpRight size={14}/></a>}
        <button className={`ack-button ${acknowledged ? "acked" : ""}`} onClick={acknowledge} disabled={acknowledged || !connected}>
          {acknowledged ? <><CheckCircle2 size={19}/> Acknowledgement sent</> : <><HeartHandshake size={19}/> I've received the alert</>}
        </button>
        <p className="ack-caption">{acknowledged ? "The server confirmed your acknowledgement and passed it to the Saathi user." : "Tap to confirm you have seen this. The sender is told right away."}</p>
      </section> : !incident?.resolved && <section className="waiting-card"><div className="waiting-icon"><BellRing size={25}/></div><h2>Waiting for a safety alert</h2><p>Keep this page open. When the Saathi user activates SOS, the alert will appear here automatically.</p><div className="waiting-line"><span/> Listening for incoming messages</div></section>}

      <section className="message-card">
        <div className="section-head"><div><div className="overline">TWO-WAY COMMUNICATION</div><h2>Messages</h2></div><span className="message-count">{messages.length} messages</span></div>
        <div className="message-list">
          {messages.length === 0 ? <div className="message-empty"><MessageCircle size={20}/><span>Messages between you and Saathi will appear here.</span></div> : messages.map((m, i) => <div className={`message-bubble ${m.senderRole === "mother" ? "mine" : "theirs"}`} key={m.id || `${m.sentAt}-${i}`}><b>{m.senderName || (m.senderRole === "mother" ? "Mother" : "Saathi user")}</b><p>{m.text}</p><small>{clock(m.sentAt)}</small></div>)}
          <div ref={endRef}/>
        </div>
        <div className="quick-replies">{QUICK_REPLIES.map(q => <button key={q} className="quick-reply" disabled={!connected} onClick={() => sendMessage(q)}>{q}</button>)}</div>
        <div className="compose-row"><input value={text} onChange={e => setText(e.target.value)} placeholder="Reply to your loved one…" maxLength={500} onKeyDown={e => e.key === "Enter" && sendMessage()}/><button onClick={() => sendMessage()} disabled={!text.trim() || !connected}><Send size={16}/><span>Send</span></button></div>
      </section>

      <section className="activity-card">
        <div className="section-head"><div><div className="overline">SERVER ACTIVITY</div><h2>Recent events</h2></div><Activity size={18}/></div>
        {events.length ? events.map(e => <div className="activity-row" key={e.id}><span className="activity-check"><CheckCircle2 size={14}/></span><b>{e.label}</b><small>{e.time}</small></div>) : <p className="muted-empty">No server events yet.</p>}
      </section>
      <div className="safety-disclaimer"><Phone size={15}/> Prototype only. For immediate danger in India, call 112. This portal does not contact emergency services.</div>
    </main>
  </div>;
}
