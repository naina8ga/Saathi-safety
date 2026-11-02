# Saathi — Personal Safety Coordination Prototype

A permission-aware, "agentic" personal safety app: one tap starts an incident workflow that alerts a trusted
contact in real time, shares location only with consent, escalates if nobody responds, and keeps an honest
audit trail of what really happened.

> **Prototype, not an emergency service.** No SMS, calls or police dispatch exist. Only the *live-link contact*
> (the Mother Client app) receives real alerts, over a local server. For danger in India call **112**.

## Architecture

| Part | Folder | Port | Purpose |
|---|---|---|---|
| Saathi app (the user) | project root (`src/`) | 5173 | React + Vite. SOS, agents, map, assistant, settings |
| Communication server | `communication-server/` | 4000 | Node + Express + Socket.IO. Relays alerts, acks, chat, location |
| Mother Client (receiver) | `mother-client/` | 5174 | Separate React app a family member keeps open |

All three join the demo room `SAATHI-JIIT-DEMO`. Server state is in memory (cleared on restart).

## Run in VS Code (Windows / macOS / Linux)

Requires **Node.js 18+** (`node -v`). Do not copy `node_modules` between machines; install fresh.

1. Open the project folder in VS Code (**File → Open Folder**), then open a terminal (**Ctrl+`**).
2. Install everything once:
   ```bash
   npm run setup
   ```
3. Start all three apps with one command:
   ```bash
   npm run dev:all
   ```
   Or use three terminals: `npm run server`, `npm run dev`, `npm run mother`.
4. Open **http://localhost:5173** (Saathi user) and **http://localhost:5174** (Mother Client) side by side.

Troubleshooting: *port in use* → close the old terminal or change the port; *"server not connected" banner* → the
server isn't running (`npm run server`); *blank page* → check the browser console and that `npm run setup` finished.

### Two devices on the same Wi-Fi
Run `npm run dev:all`, find the laptop's IPv4 (`ipconfig` / `ifconfig`), and open `http://LAPTOP-IP:5174` on the phone.
The apps automatically talk to the server on the host they were opened from (no `.env` edit needed; set
`VITE_SERVER_URL` only to override). Allow Node through the firewall on private networks.
Browsers only allow geolocation on **localhost or HTTPS**, so run the Saathi user app on the laptop and use the
phone for the Mother Client.

## Functionality

**Saathi app**
- **SOS** starts a persistent incident: contact alert, location handling, agent steps, audit events.
- **Four visible agents** — Intent, Planner, Coordinator, Verifier — shown in the **Agent Center**, scoped to the current incident.
- **Intent classifier**: rule-based (English, Hindi, Hinglish), shows *which phrases matched*; no ML, no invented confidence.
- **Live incident page**: contact status, real **escalation countdown** (auto-alerts the next enabled contact if nobody acknowledges; "skip wait" button), map, chat with Mother, verification panel, user-confirmed resolution.
- **Honest verification**: server delivery receipts ("delivered to 1 Mother Client" vs "stored, she is offline" vs "failed"); simulated contacts are labelled simulated.
- **Location**: only on tap/consent; a fix older than 5 minutes is never sent; SOS never waits for GPS (fresh fix follows); optional live updates every ~10 s to the live-link contact.
- **Explore map**: Leaflet map, nearby hospitals/police/pharmacies/shops (Overpass), walking route (OSRM), clearly labelled demo markers fallback.
- **Journey check-in**: timer, then a "Are you safe?" prompt (safe / +15 min / start SOS). A missed check-in never triggers SOS by itself.
- **Safety assistant**: free-text request → classification → proposed plan → runs only after you confirm.
- **Activity timeline**: full audit log, copy or download as `.txt`.
- **Preferences**: trusted contacts (add / enable / remove / choose the *live-link* contact), escalation window and policy, location sharing, live location, journey length, reset local data.
- Data persists in `localStorage` (location is deliberately not stored). Responsive desktop/mobile layout.

**Mother Client**
- Receives SOS instantly (sound, vibration, notification, tab title) once "Enable alerts" is tapped; late joiners and refreshes recover the current incident and chat.
- "I've received the alert" is only marked sent after the server confirms; the user sees it in real time.
- Shows shared coordinates with a map link and live location updates; shows when the user marks themselves safe.
- Two-way chat with quick replies; presence of the Saathi user; recent server events.

**Server**: role-checked events (only the user can raise alerts, only the receiver can acknowledge), input sanitising and length caps, delivery receipts, chat history (last 50), resolve events, `/health` endpoint.

## Scripts
`npm run setup` · `dev:all` · `dev` · `server` · `mother` · `dev:lan` · `build` · `test` (unit tests for intent, escalation, location freshness).

## Known limitations
- Contact alerts other than the live-link contact are simulated. No real SMS/WhatsApp/calls/police.
- The browser must stay open for the escalation timer and journey check-in (no background service).
- Nearby places/routes depend on public Overpass/OSRM services and Esri map tiles; check their usage terms before any public deployment.
- The demo room name is shared and there is no authentication — do not expose the server to the internet.
