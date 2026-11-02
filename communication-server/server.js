import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 4000;
const ROOM_DEFAULT = "SAATHI-JIIT-DEMO";
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || true; // true = reflect request origin (demo/LAN friendly)
const MAX_TEXT = 500;
const MAX_HISTORY = 50;

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "20kb" }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGIN, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

// In-memory demo state (cleared on server restart)
const rooms = new Map(); // room -> { incident, acknowledgedBy: Set, messages: [] }
const roomState = (room) => {
  if (!rooms.has(room)) rooms.set(room, { incident: null, acknowledged: false, messages: [], womanLastSeenAt: null });
  return rooms.get(room);
};

const clean = (value, max = MAX_TEXT) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const safeRoom = (value, fallback) => clean(value || fallback || ROOM_DEFAULT, 64) || ROOM_DEFAULT;
const finiteOrNull = (n) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? Number(n) : null);
const cleanLocation = (loc) => {
  if (!loc || typeof loc !== "object") return null;
  const lat = finiteOrNull(loc.lat), lng = finiteOrNull(loc.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: finiteOrNull(loc.accuracy), capturedAt: clean(loc.capturedAt, 40) || null };
};

// Battery is the only device detail relayed. Anything malformed becomes null instead of being trusted.
const cleanDevice = (d) => {
  const level = Number(d?.battery?.level);
  if (!d || typeof d !== "object" || !Number.isFinite(level) || d?.battery?.level === null || d?.battery?.level === "") return null;
  return { battery: { level: Math.round(Math.min(100, Math.max(0, level))), charging: Boolean(d.battery.charging) } };
};

async function receiversIn(room, role) {
  const sockets = await io.in(room).fetchSockets();
  return sockets.filter((s) => s.data.role === role).length;
}

app.get("/", (_req, res) => res.json({
  service: "Saathi Communication Server",
  status: "online",
  transport: "Socket.IO",
  demoRoom: ROOM_DEFAULT,
  note: "Hackathon demonstration server. Not an emergency service."
}));
app.get("/health", (_req, res) => res.json({ ok: true, connectedClients: io.engine.clientsCount }));

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("room:join", async ({ room, role, displayName } = {}) => {
    const roomName = safeRoom(room);
    const safeRole = ["woman", "mother"].includes(role) ? role : "unknown";
    socket.join(roomName);
    socket.data.room = roomName;
    socket.data.role = safeRole;
    socket.data.displayName = clean(displayName, 40) || "Client";

    const state = roomState(roomName);
    const [womanOnline, motherOnline] = await Promise.all([receiversIn(roomName, "woman"), receiversIn(roomName, "mother")]);

    socket.to(roomName).emit("presence:update", {
      role: safeRole, displayName: socket.data.displayName, status: "online", at: new Date().toISOString()
    });
    socket.emit("room:joined", { room: roomName, role: safeRole, ok: true });
    // Lets a (re)connecting client rebuild its view: presence, current incident, chat history.
    socket.emit("state:sync", {
      room: roomName,
      presence: { woman: womanOnline > 0, mother: motherOnline > 0 },
      incident: state.incident,
      acknowledged: state.acknowledged,
      messages: state.messages,
      womanLastSeenAt: state.womanLastSeenAt
    });
    console.log(`[join] ${socket.data.displayName} (${safeRole}) -> ${roomName}`);
  });

  socket.on("incident:alert", async (payload = {}, ack) => {
    if (socket.data.role !== "woman") { ack?.({ ok: false, error: "Only the Saathi user can start an alert." }); return; }
    const room = socket.data.room || ROOM_DEFAULT;
    const state = roomState(room);
    const incident = {
      room,
      incidentId: clean(payload.incidentId, 40),
      message: clean(payload.message),
      source: clean(payload.source, 60),
      startedAt: clean(payload.startedAt, 40) || new Date().toISOString(),
      location: cleanLocation(payload.location),
      device: cleanDevice(payload.device),
      senderName: clean(payload.senderName, 40) || "Saathi user",
      senderRole: "woman",
      receivedAt: new Date().toISOString(),
      serverStatus: "received-by-server",
      resolved: false
    };
    if (!incident.incidentId) { ack?.({ ok: false, error: "Missing incident id." }); return; }
    state.incident = incident;
    state.acknowledged = false;
    socket.to(room).emit("incident:alert", incident);
    const receivers = await receiversIn(room, "mother");
    console.log(`[incident] ${incident.incidentId} -> ${room} (receivers online: ${receivers})`);
    // The callback is the real delivery signal: how many Mother clients were online right now.
    ack?.({ ok: true, incidentId: incident.incidentId, receivers, storedForLateJoin: true });
  });

  socket.on("location:update", (payload = {}) => {
    if (socket.data.role !== "woman") return;
    const room = socket.data.room || ROOM_DEFAULT;
    const state = roomState(room);
    const location = cleanLocation(payload.location);
    if (!location || !state.incident || state.incident.resolved) return;
    if (clean(payload.incidentId, 40) !== state.incident.incidentId) return;
    state.incident.location = location; // late joiners get the latest fix
    socket.to(room).emit("location:update", { incidentId: state.incident.incidentId, location, receivedAt: new Date().toISOString() });
  });

  socket.on("device:update", (payload = {}) => {
    if (socket.data.role !== "woman") return;
    const room = socket.data.room || ROOM_DEFAULT;
    const state = roomState(room);
    const device = cleanDevice(payload.device);
    if (!device || !state.incident || state.incident.resolved) return;
    if (clean(payload.incidentId, 40) !== state.incident.incidentId) return;
    state.incident.device = device; // late joiners get the latest battery reading
    socket.to(room).emit("device:update", { incidentId: state.incident.incidentId, device, receivedAt: new Date().toISOString() });
  });

  socket.on("incident:escalation", (payload = {}) => {
    if (socket.data.role !== "woman") return;
    const room = socket.data.room || ROOM_DEFAULT;
    socket.to(room).emit("incident:escalation", {
      incidentId: clean(payload.incidentId, 40),
      contactName: clean(payload.contactName, 60),
      detail: clean(payload.detail),
      receivedAt: new Date().toISOString()
    });
  });

  socket.on("incident:acknowledge", (payload = {}, ack) => {
    if (socket.data.role !== "mother") { ack?.({ ok: false }); return; }
    const room = socket.data.room || ROOM_DEFAULT;
    const state = roomState(room);
    const incidentId = clean(payload.incidentId, 40);
    if (!state.incident || state.incident.incidentId !== incidentId) { ack?.({ ok: false, error: "Unknown or outdated incident." }); return; }
    state.acknowledged = true;
    const ackPayload = {
      incidentId,
      from: socket.data.displayName || "Mother",
      message: clean(payload.message),
      acknowledgedAt: new Date().toISOString(),
      senderRole: "mother"
    };
    socket.to(room).emit("incident:acknowledged", ackPayload);
    ack?.({ ok: true });
    console.log(`[ack] ${incidentId} by ${ackPayload.from}`);
  });

  socket.on("incident:resolve", (payload = {}) => {
    if (socket.data.role !== "woman") return;
    const room = socket.data.room || ROOM_DEFAULT;
    const state = roomState(room);
    const incidentId = clean(payload.incidentId, 40);
    if (state.incident && state.incident.incidentId === incidentId) {
      state.incident.resolved = true;
      state.incident.resolvedAt = new Date().toISOString();
    }
    socket.to(room).emit("incident:resolved", { incidentId, resolvedAt: new Date().toISOString(), by: "user" });
    console.log(`[resolve] ${incidentId}`);
  });

  socket.on("chat:send", (payload = {}, ack) => {
    const room = socket.data.room || ROOM_DEFAULT;
    const text = clean(payload.text);
    if (!text) { ack?.({ ok: false }); return; }
    const message = {
      id: clean(payload.id, 40) || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      incidentId: clean(payload.incidentId, 40) || null,
      text,
      senderRole: socket.data.role || "unknown", // never trusted from the client
      senderName: socket.data.displayName || "Client",
      sentAt: new Date().toISOString()
    };
    const state = roomState(room);
    state.messages.push(message);
    if (state.messages.length > MAX_HISTORY) state.messages.shift();
    io.to(room).emit("chat:message", message);
    ack?.({ ok: true, id: message.id });
    console.log(`[chat] ${message.senderName}: ${message.text}`);
  });

  socket.on("disconnect", (reason) => {
    const room = socket.data.room;
    if (room && socket.data.role === "woman") roomState(room).womanLastSeenAt = new Date().toISOString();
    if (room) socket.to(room).emit("presence:update", {
      role: socket.data.role, displayName: socket.data.displayName,
      status: "offline", at: new Date().toISOString()
    });
    console.log(`[disconnect] ${socket.id}: ${reason}`);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Saathi communication server listening on http://localhost:${PORT}`);
  console.log(`Demo room: ${ROOM_DEFAULT}`);
});
