# Steeradar

<div align="center">

<img src="https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png" alt="Steeradar" width="140" height="140" />

### Live community rides. Peer chat. Local mesh. Universal DB.

**A vehicle-gated, modular, serverless-first community network — built in plain HTML, CSS & JavaScript.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-suryasticsai.github.io-0D9488?style=for-the-badge&logo=github)](https://suryasticsai.github.io/Steeradar/)
[![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](./LICENSE)
[![Made with](https://img.shields.io/badge/Made%20with-Vanilla%20JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Modules](https://img.shields.io/badge/Modules-11-7C3AED?style=for-the-badge)](./js)
[![No Build](https://img.shields.io/badge/No-Build%20Step-4F46E5?style=for-the-badge)](https://github.com/suryasticsai/Steeradar)

</div>

---

## 📖 What is Steeradar

Steeradar is a **community movement protocol**. Any group that repeats a local journey — a bus route, a carpool, a jogging pack, a walk, a delivery run, an event shuttle — gets a live, discoverable **lane** that anyone nearby can join.

Built on plain web primitives — WebRTC, Geolocation, Bluetooth, and a single Google Sheet as the universal database — Steeradar runs entirely from **GitHub Pages** with **zero backend infrastructure**, **zero commission**, and **zero login wall**.

> **Enter your vehicle number → your neighbourhood comes alive.**

---

## ✨ Features

### 🚗 Vehicle Gate
The app unlocks only after a valid vehicle number. It becomes your identity — your lanes, your Hive posts, your peer ID.

### 📷 Photo Documents
Optional onboarding step to upload your photo, vehicle photo, number plate, and UPI QR — stored securely on Google Drive.

### 🗺️ Pulse — Live Community Map
Bright OpenFreeMap canvas with emoji markers for every active lane. Real-time movement animations, pulsing rings, filters: **Live now · All · Has seats · My lanes**.

### 🛣️ Lanes — Real-Time Driver Feed
Editorial cards with animated occupancy rings, vehicle-type badges, route previews, fare tags, and one-tap Chat / Track / Request. **Edit your own lanes inline.**

### 📍 Live Tracking (Zomato-style)
Tap **Track** on any lane → OSRM routing draws the real driving path to your pickup, with live distance, ETA, and seat count in a floating HUD.

### 📡 Near — Local Mesh & Proximity Radar
Your GPS coordinate becomes a **geohash** — everyone within ~1 km auto-forms a PeerJS room without any server. Includes **real Web Bluetooth scan**.

### 🐝 Hive — Community Board
Deepstash-style editorial feed. Story circles for active drivers. Single-form composer (heading + body + tags). **Edit and delete your own posts.**

### 💬 Peer Chat with Persistence
Real-time WebRTC delivery + every message saved to the `messages` sheet. Reopening a chat loads the last 50 messages.

### ⚙️ Full Settings
Account (OTP sign-in) · Profile · Appearance (theme + map style) · Notifications · Privacy (GPS, ghost mode, plate visibility) · Universal DB · Data (clear / reset).

### 📋 Hidden Diagnostics
Long-press the **Steeradar** logo for 600ms → in-app log viewer with **Copy · Clear · Refresh**. Tap the version line 5× in Settings → reveals the cloud endpoint config.

---

## 🏗️ Architecture

### Modular JS — 11 files, each under 300 lines

```
js/
├── api.js          · Network gateway (every fetch goes through here)
├── store.js        · Shared state, storage, session, utils
├── logger.js       · In-app console capture + log viewer
├── auth.js         · OTP login / register flow
├── onboarding.js   · Vehicle gate + photo step
├── photos.js       · Image compression + Drive upload
├── lanes.js        · Post/view lanes, edit, map markers
├── hive.js         · Posts + likes + edit/delete
├── chat.js         · WebRTC + persistent messages
├── presence.js     · Live tracking + geohash mesh
└── app.js          · Boot, tabs, settings, wiring
```

Every module imports only what it needs. Changes to `chat.js` never touch `lanes.js`.

### Peer layers

```
PEER A — Vehicle ID
  steeradar-veh-<VEHICLE>
  Used for: lane chats (1:1 WebRTC)

PEER B — Geohash Room Slot
  steeradar-loc-<geohash>-<slot 1..20>
  Used for: local mesh (auto-forms within ~1 km)

PEER C — Bluetooth
  navigator.bluetooth.requestDevice()
  Used for: proximity scan of BLE peripherals
```

### Cloud sync flow

```
Publish lane → save local + push to Apps Script → row in Google Sheet
              ↓
Every 15s:  fetch lanes + posts → merge → re-render
Every 20s:  heartbeat presence with GPS + vehicle type
```

### Live tracking flow

```
Tap Track → draw pickup pin + vehicle pin
          → OSRM fetch driving route (free, no key)
          → draw teal dashed polyline
          → recompute every 8s as vehicle moves
          → HUD shows distance / ETA / seats
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
| Styling | Vanilla CSS (light-first, Deepstash-inspired) |
| Logic | Vanilla JavaScript (ES Modules, ES2020) |
| Maps | [Leaflet](https://leafletjs.com/) + [MapLibre GL](https://maplibre.org/) |
| Tiles | [OpenFreeMap](https://openfreemap.org/) — no API key |
| Routing | [OSRM](https://project-osrm.org/) — free, no signup |
| Geocoding | [Nominatim](https://nominatim.org/) (OpenStreetMap) |
| Real-time chat | [PeerJS](https://peerjs.com/) (WebRTC) |
| Proximity mesh | Custom geohash + PeerJS slot claiming |
| Bluetooth | Web Bluetooth API |
| Universal DB | Google Apps Script + Sheets |
| Image storage | Google Drive (via Apps Script) |
| Hosting | GitHub Pages |

**Zero build step. Zero npm. Zero bundlers.**

---

## 🚀 Quick Start

### Run it live
👉 **[https://suryasticsai.github.io/Steeradar/](https://suryasticsai.github.io/Steeradar/)**

### Run locally
```bash
git clone https://github.com/suryasticsai/Steeradar.git
cd Steeradar
python3 -m http.server 8000
# open http://localhost:8000
```

### Deploy your own
1. Fork this repo
2. **Settings → Pages → Source: `main` / root**
3. Live in ~30 seconds at `https://<your-username>.github.io/Steeradar/`

---

## 🗄️ Apps Script Backend Setup

The DB lets every device see the same lanes, posts, messages, and presence. Setup takes ~5 minutes.

### 1. Create the project
1. Open **[script.new](https://script.new)** → rename to **Steeradar DB**
2. Delete default code → paste the contents of **[`Code.gs`](./Code.gs)**
3. **Ctrl + S**

### 2. Authorize + create the Sheet
1. Function dropdown → **`setup`** → **Run**
2. **Review permissions → Advanced → Go to project → Allow**
3. Copy the printed Sheet URL

### 3. Run the self-test
1. Function dropdown → **`selfTest`** → **Run**
2. Expect:
   ```
   users    write: PASS
   sessions write: PASS
   lanes    write: PASS
   hive     write: PASS
   messages write: PASS
   presence write: PASS
   trips    write: PASS
   ```

### 4. Deploy as Web App
1. **Deploy → New deployment → Web app**
2. Execute as: **Me**
3. Who has access: **Anyone**
4. Copy the `/exec` URL

### 5. Wire it up
Edit `config.js`:
```javascript
SHEET_API_URL: 'https://script.google.com/macros/s/AKfyc.../exec',
SHEET_WEBHOOK_SECRET: 'steeradar-secret-2026',
```

Commit, push, hard-refresh. Verify in Settings → Universal DB → **Test connection** → **✓ Connected**.

---

## 📊 Sheet Schema

| Sheet | Purpose |
|---|---|
| **users** | phone, email, name, vehicle, avatar, plate, UPI QR, session refs |
| **sessions** | Auth tokens (90-day expiry) |
| **otps** | Login + register OTP audit trail |
| **lanes** | Live lanes with vehicleType + GPS + lastSeen |
| **hive** | Community posts + likes |
| **messages** | Persistent chat history |
| **presence** | Active vehicles + GPS heartbeat (2-min freshness) |
| **trips** | Start/end time, distance, fare, rating |

---

## 🎯 Beyond buses — the real USP

A vehicle number is one kind of persistent public identifier. The same pattern works for:

| Activity | Identifier | Lane | Fare |
|---|---|---|---|
| Community bus | Bus reg | Route + occupancy | Ticket price |
| Carpool | Car reg | Daily commute | Fuel share |
| Auto pool | Auto reg | Shared trip | Split meter |
| Walking group | Group name | Route + pace | Free |
| Morning jog | Route ID | Pace + meetup | Free |
| Cycling pack | Pack name | Route + speed | Free |
| Event shuttle | Event code | Pickup points | Bundled |
| Delivery coop | Vehicle ID | Delivery route | Per parcel |
| Farm-to-home | Producer ID | Weekly run | Per basket |
| School run | Parent group | School route | Free swap |

**Steeradar is a protocol for community movement.** Fork it, run your own.

---

## 🗺️ Roadmap

- [x] Vehicle gate & validation
- [x] Live community map (OpenFreeMap)
- [x] WebRTC lane chats (PeerJS)
- [x] Geohash local mesh (serverless)
- [x] Real Web Bluetooth scan
- [x] Universal DB via Google Sheets
- [x] Modular 11-file architecture
- [x] OTP authentication (email)
- [x] Image uploads (Google Drive)
- [x] Live tracking (OSRM route lines)
- [x] In-app diagnostics log viewer
- [x] Edit / delete lanes and posts
- [ ] UPI payment flow (scan QR → pay → confirm)
- [ ] Post-trip ratings
- [ ] Push notifications (FCM)
- [ ] PWA install prompt
- [ ] Offline mode (Service Worker)
- [ ] Multi-language support
- [ ] Self-hosted OSRM

---

## 🔐 Privacy & Security

- **No tracking** — no analytics, no third-party scripts
- **Vehicle-gated** — no anonymous access
- **Cloud-optional** — everything works locally if cloud sync is disabled
- **Ghost mode** — hide your location from the map
- **Masked plates** — control who sees your number plate
- **UID-protected** — every write goes through the vehicle identity
- **Secret-keyed** — Apps Script rejects any request without the correct key
- **Session tokens** — 90-day, hashed, revocable

---

## 🤝 Contributing

Steeradar is intentionally minimal. No build step, no framework, no lock-in.

```bash
git checkout -b feature/amazing-idea
git commit -m "Add amazing idea"
git push origin feature/amazing-idea
```

Open a PR. Bug reports with the in-app log (long-press logo → Copy) are gold.

---

## 👤 About the Maker

<div align="center">

<img src="https://avatars.githubusercontent.com/suryasticsai" alt="@suryasticsai" width="120" height="120" style="border-radius: 50%;" />

### Sai Varakala ☀️

**Techno Agilist · SAFe Scrum Master @ TCS**

</div>

I build open-source tools that solve small, real problems for real people — neighbourhood ride networks, offline-first AI assistants, and privacy-respecting utilities. Steeradar started as a weekend question: *"Can a whole ride-sharing app work without a backend?"* It grew into a modular, working peer-to-peer mesh running entirely on GitHub Pages.

Everything I publish follows three rules:

1. **Readable in one sitting**
2. **Deployable by anyone with a GitHub account**
3. **No tracking, no lock-in, no compromise**

If Steeradar saves you a bus fare or teaches you one thing about WebRTC — mission accomplished.

⭐ **Star the repo if it helped** — it genuinely means a lot.

---

## 📬 Connect

<div align="center">

| Platform | Handle |
|---|---|
| 💼 LinkedIn | [linkedin.com/in/suryasticsai](https://www.linkedin.com/in/suryasticsai) |
| 📝 Medium | [suryasticsai.medium.com](https://suryasticsai.medium.com) |
| 🐙 GitHub | [github.com/suryasticsai](https://github.com/suryasticsai) |
| 🤗 Hugging Face | [huggingface.co/spaces/Suryasticsai](https://huggingface.co/spaces/Suryasticsai) |
| 📷 Instagram | [instagram.com/saisuryastic](https://instagram.com/saisuryastic) |
| ✉️ Email | [suryasticsai@gmail.com](mailto:suryasticsai@gmail.com) |

**Everything at one handle → `@suryasticsai`**

</div>

---

## 📜 License

MIT © [Sai Varakala](https://github.com/suryasticsai)

Free to fork, remix, ship. Attribution appreciated, not required.

---

## 🙏 Built on the shoulders of

- [Leaflet](https://leafletjs.com/) — the friendliest map library on the web
- [MapLibre GL](https://maplibre.org/) — the open vector map engine
- [OpenFreeMap](https://openfreemap.org/) — free, keyless vector tiles
- [OSRM](https://project-osrm.org/) — open-source routing machine
- [PeerJS](https://peerjs.com/) — WebRTC made human
- [OpenStreetMap](https://www.openstreetmap.org/) — the free world map
- [Nominatim](https://nominatim.org/) — reverse geocoding for everyone
- [Google Apps Script](https://developers.google.com/apps-script) — the serverless backend nobody pays for

---

<div align="center">

### 🌟 If you made it this far — thank you.

**Steeradar** is a bet that the web can be simpler, fairer, and more local.

[⭐ Star on GitHub](https://github.com/suryasticsai/Steeradar) · [🚀 Try Live](https://suryasticsai.github.io/Steeradar/) · [💬 Say Hi](mailto:suryasticsai@gmail.com)

<sub>Made with ☀️ by <a href="https://github.com/suryasticsai">@suryasticsai</a></sub>

</div>