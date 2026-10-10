# Steeradar

<div align="center">

<img src="https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png" alt="Steeradar" width="140" height="140" />

### Live community rides. Peer chat. Local mesh. Universal DB.

**A vehicle-gated, serverless-first community network — built in plain HTML, CSS & JavaScript.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-suryasticsai.github.io-0D9488?style=for-the-badge&logo=github)](https://suryasticsai.github.io/Steeradar/)
[![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](./LICENSE)
[![Made with](https://img.shields.io/badge/Made%20with-Vanilla%20JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![No Build](https://img.shields.io/badge/No-Build%20Step-7C3AED?style=for-the-badge)](https://github.com/suryasticsai/Steeradar)

</div>

---

## 📖 What is Steeradar

Steeradar is a **community movement protocol**. Any group that repeats a local journey — a bus route, a carpool, a jogging pack, a walk, a delivery run, an event shuttle — gets a live, discoverable **lane** that anyone nearby can join.

Built on plain web primitives — WebRTC, Geolocation, Bluetooth, and a single Google Sheet as the universal database — Steeradar runs entirely from **GitHub Pages** with **zero backend infrastructure**, **zero commission**, and **zero login wall**.

> **Enter your vehicle number → your neighbourhood comes alive.**

---

## ✨ Features

### 🚗 Vehicle Gate
The app doesn't unlock without a valid vehicle number. It becomes your identity — your lanes, your Hive posts, your peer ID. Change it anytime from Settings.

### 🗺️ Pulse — Live Community Map
A clean, bright (or dark) OpenFreeMap canvas with pulsing markers for every active lane. Tap any marker for route, seats, fare, and one-tap Chat / Request. Filters: **Live now · All · Has seats · My lanes**.

### 🛣️ Lanes — Real-Time Driver Feed
Every active lane as an editorial card with an animated occupancy ring, seat count, route preview, fare tag, driver info, and Chat / Request actions. Your own lanes glow teal with a **YOU** badge.

### 📡 Near — Local Mesh & Proximity Radar
Your GPS coordinate becomes a 6-char **geohash** — a ~1 km × 0.6 km cell. Everyone in the same cell joins a shared PeerJS room without any server, chatting instantly. Also includes a **real Web Bluetooth scan** for nearby BLE devices.

### 🐝 Hive — Community Board
A Deepstash-style editorial feed of local posts. Story circles for active drivers. Tap any post for detail view. Like counts sync to the universal DB and via WebRTC broadcast.

### 🤖 Universal DB (Google Sheets)
Every lane and post syncs to a Google Sheet via Apps Script. Any device, any browser — everyone sees the same feed within 15 seconds. Configurable in `config.js`.

### ⚙️ Real Settings Panel
Tap your avatar for a full sheet: Profile · Appearance (theme + map) · Notifications · Privacy (GPS, ghost mode) · Universal DB · Data (clear / reset). Every switch is honored instantly.

---

## 🎯 Beyond buses — the real USP

Steeradar is **not a bus app**. A vehicle number is just one kind of persistent public identifier. The same pattern works for:

| Activity | Identifier | Lane | Fare |
|---|---|---|---|
| Community bus | Bus reg number | Route + occupancy | Ticket price |
| Carpool | Car reg number | Daily commute | Fuel share |
| Auto pool | Auto reg number | Shared trip | Split meter |
| Walking group | Group name | Route + pace | Free |
| Morning jog | Route ID | Pace + meetup | Free |
| Cycling pack | Pack name | Route + speed | Free |
| Event shuttle | Event code | Pickup points | Bundled |
| Delivery coop | Vehicle ID | Delivery route | Per parcel |
| Farm-to-home | Producer ID | Weekly run | Per basket |
| School run | Parent group | School route | Free swap |

**Steeradar is a protocol for community movement.** Fork it, run your own.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
| Styling | Vanilla CSS (Deepstash-inspired, light-first) |
| Logic | Vanilla JavaScript (ES2020) |
| Maps | [Leaflet](https://leafletjs.com/) + [MapLibre GL](https://maplibre.org/) |
| Tiles | [OpenFreeMap](https://openfreemap.org/) — no API key needed |
| Geocoding | [Nominatim](https://nominatim.org/) (OpenStreetMap) |
| Real-time chat | [PeerJS](https://peerjs.com/) (WebRTC) |
| Proximity mesh | Custom geohash + PeerJS slot claiming |
| Bluetooth | Web Bluetooth API |
| Universal DB | Google Apps Script + Sheets |
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

## 🗄️ Setting up the Universal DB (Google Sheets)

The DB lets every device see the same lanes and posts. It takes about 5 minutes.

### 1. Create the Apps Script project
1. Go to **[script.new](https://script.new)** — a new Apps Script project opens
2. Rename it to **Steeradar DB**
3. Delete all existing code in `Code.gs`
4. Paste the contents of **[`Code.gs`](./Code.gs)** from this repo
5. **Ctrl + S** to save

### 2. Authorize + create the Sheet
1. Function dropdown → select **`setup`** → click **Run**
2. When prompted: **Review permissions → Advanced → Go to Steeradar DB (unsafe) → Allow**
3. Watch the Execution log — you'll see:
   ```
   Sheet URL: https://docs.google.com/spreadsheets/d/...
   lanes tab: OK
   hive tab:  OK
   Mail: authorized
   Done.
   ```

### 3. Verify the backend
1. Function dropdown → select **`selfTest`** → click **Run**
2. Log should show:
   ```
   lanes write+read: PASS
   hive write+read:  PASS
   cleanup done
   ```

### 4. Deploy as Web App
1. **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Click **Deploy** → copy the `/exec` URL

### 5. Wire it up
1. Open **`config.js`** in this repo
2. Replace `SHEET_API_URL` with your `/exec` URL:
   ```javascript
   SHEET_API_URL: 'https://script.google.com/macros/s/AKfyc.../exec',
   SHEET_WEBHOOK_SECRET: 'steeradar-secret-2026',  // must match Code.gs
   ```
3. Commit and push
4. On the live site, hard refresh → Settings → **Test connection** → should say **✓ Connected**

---

## 🏗️ Architecture

### Peer layers

```
┌───────────────────────────────────────────────────────────────┐
│  PEER A — Vehicle ID                                          │
│  steeradar-veh-<VEHICLE>                                      │
│  Used for: lane chats (direct 1:1 WebRTC)                     │
├───────────────────────────────────────────────────────────────┤
│  PEER B — Geohash Room Slot                                   │
│  steeradar-loc-<geohash>-<slot 1..20>                         │
│  Used for: local mesh (auto-forms around ~1 km radius)        │
├───────────────────────────────────────────────────────────────┤
│  PEER C — Bluetooth                                           │
│  navigator.bluetooth.requestDevice()                          │
│  Used for: proximity scan of nearby BLE peripherals           │
└───────────────────────────────────────────────────────────────┘
```

### Cloud sync flow

```
Publish lane → save to localStorage + push to Apps Script → row in Google Sheet
              ↓
Every 15 s:  fetch all lanes + posts → merge with local → re-render
```

### Local mesh flow

```
GPS → geohash(6) → room prefix → claim slot 1..20
                                     ↓
                        scan all other slots every 30 s
                                     ↓
                     on connect → exchange hello packets
                                     ↓
                            broadcast chat to peers
```

---

## 🎨 Design Language

| Token | Value | Usage |
|---|---|---|
| Background | `#FFFFFF` | Editorial canvas |
| Surface | `#F1F3F6` | Soft cards |
| Text | `#111827` | High contrast |
| Teal | `#0D9488` | Primary accent |
| Coral | `#DC2626` | Alerts & fares |
| Amber | `#D97706` | Fare tags |
| Violet | `#7C3AED` | AI, Bluetooth |
| Serif | `Charter / Georgia` | Headlines |
| Sans | System UI | Body |

Light theme is primary. Dark theme available in Settings. Everything is a token — no hardcoded colors.

---

## 🗺️ Roadmap

- [x] Vehicle gate & validation
- [x] Live community map (OpenFreeMap)
- [x] WebRTC lane chats (PeerJS)
- [x] Geohash local mesh (serverless)
- [x] Real Web Bluetooth scan
- [x] Universal DB via Google Sheets
- [x] Deepstash-inspired editorial UI
- [x] Full Settings panel (theme, privacy, data)
- [x] Cross-device lane + post sync
- [ ] Service worker for offline mode
- [ ] PWA install prompt
- [ ] Encrypted local storage
- [ ] Multi-language support
- [ ] Ride history & receipts
- [ ] Driver reputation system
- [ ] Group fare splitting
- [ ] Own PeerServer for production scale

---

## 🤝 Contributing

Steeradar is intentionally minimal — three files, no build step, one weekend's worth of code. Anyone can read it in one sitting.

```bash
git checkout -b feature/amazing-idea
git commit -m "Add amazing idea"
git push origin feature/amazing-idea
```

Open a PR. Bug reports with browser + device info are especially welcome.

---

## 👤 About the Maker

<div align="center">

<img src="https://avatars.githubusercontent.com/suryasticsai" alt="@suryasticsai" width="120" height="120" style="border-radius: 50%;" />

### Sai Varakala ☀️

**Techno Agilist · SAFe Scrum Master @ TCS**

</div>

I build open-source tools that solve small, real problems for real people — neighbourhood ride networks, offline-first AI assistants, and privacy-respecting utilities. Steeradar started as a weekend question: *"Can a whole ride-sharing app work without a backend?"* It grew into a working peer-to-peer mesh and a real cross-device product running on GitHub Pages.

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