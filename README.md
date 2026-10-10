<!-- ================================================================ -->
<!--                        STEERADAR README                          -->
<!-- ================================================================ -->

<div align="center">

<img src="https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png" alt="Steeradar Logo" width="140" height="140" style="border-radius: 50%;" />

# Steer**adar**.

### Live community rides. Real peer chat. Local mesh. Zero backend.

**A vehicle-gated, serverless, peer-to-peer community ride network — built entirely in vanilla HTML, CSS & JavaScript.**

[![Made with Love](https://img.shields.io/badge/Made%20with-%E2%9D%A4%EF%B8%8F-FF6B4A?style=for-the-badge)](https://github.com/suryasticsai)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![No Backend](https://img.shields.io/badge/No-Backend-00E5C3?style=for-the-badge)](https://github.com/suryasticsai/Steeradar)
[![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-181717?style=for-the-badge&logo=github)](https://suryasticsai.github.io/Steeradar/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](./LICENSE)

[**🚀 Live Demo**](https://suryasticsai.github.io/Steeradar/) · [**🐛 Report Bug**](https://github.com/suryasticsai/Steeradar/issues) · [**✨ Request Feature**](https://github.com/suryasticsai/Steeradar/issues)

</div>

---

<div align="center">

### 📖 Table of Contents

[✨ What is Steeradar](#-what-is-steeradar) ·
[🎯 Motivation](#-motivation) ·
[⚡ Features](#-features) ·
[🛠️ Tech Stack](#️-tech-stack) ·
[🚀 Quick Start](#-quick-start) ·
[🏗️ Architecture](#️-architecture) ·
[🎨 Design Language](#-design-language) ·
[🗺️ Roadmap](#️-roadmap) ·
[🤝 Contributing](#-contributing) ·
[👤 About the Maker](#-about-the-maker) ·
[📬 Connect](#-connect)

</div>

---

## ✨ What is Steeradar

**Steeradar** is a fully client-side, **no-backend community ride network** that turns any vehicle number into a live, discoverable identity. Drivers post lanes they're driving; passengers request seats; nearby vehicles auto-form a **local mesh** through geohash-based WebRTC rooms; and the whole thing runs on **GitHub Pages alone**.

No servers. No databases. No monthly bills. Just a browser, a GPS, and a handful of open-source CDNs.

> **"Enter your vehicle number → the neighbourhood comes alive."**

**[↑ Back to top](#steeradar)**

---

## 🎯 Motivation

Most ride-sharing apps today are **centralised giants** — Ola, Uber, Didi — that take 20–30% commission from drivers, own all the data, and require the rider to trust a black-box algorithm.

I wanted to see what a **community-first, driver-owned, zero-commission** alternative could look like if we stripped away everything: no backend, no database, no login wall. Just the browser's own capabilities — **WebRTC, Geolocation, Bluetooth, local storage** — stitched together cleverly enough that anyone could fork it, deploy it in 30 seconds on GitHub Pages, and run their own neighbourhood network.

The result is Steeradar. It's a **proof-of-concept**, a **learning project**, and an **open invitation** for anyone to build a fairer, more local, more human ride network on top of it.

**[↑ Back to top](#steeradar)**

---

## ⚡ Features

### 🚗 Vehicle Gate (Unlock System)

The app **does not open** until you enter a valid vehicle number. This number becomes your identity across the entire app — your lanes, your Hive posts, your peer ID, everything.

- **Validation**: 4–15 alphanumeric characters (works with any country plate)
- **Persistence**: Stored in `localStorage` under `steeradar-vehicle`
- **Change anytime**: Header badge opens a "Change vehicle" modal — resets your published lanes for a fresh start

---

### 🗺️ Pulse — Live Community Map

A dark, glowing Leaflet map where every active lane pulses with the heartbeat of its occupancy.

| Feature | Description |
|---|---|
| **Pulsing bus markers** | Teal ring animation — more occupied = faster pulse. Full lanes turn coral. |
| **Tap to open lane card** | Bottom sheet shows route, seats left, fare, driver, and quick Chat/Request buttons |
| **Live location pill** | Real reverse geocoding via Nominatim — shows your actual neighbourhood name |
| **Filters** | Live now · All · Has seats · My lanes |
| **OpenFreeMap tiles** | Dark vector tiles from OpenFreeMap — **no API key required** |

---

### 🛣️ Lanes — Real-Time Driver Feed

A scrollable feed of every active lane near you, each rendered as a rich status card.

- **Occupancy ring** — SVG `stroke-dasharray` animation that fills like liquid as seats are taken
- **Seat counter** — bold, animated, breathing number in the centre
- **Route line** — from → via → to with a bus icon
- **Fare tag** — coral pill in ₹
- **Driver card** — avatar, name, star rating
- **Actions** — 💬 Chat (WebRTC peer chat) · ＋ Request (send a seat request)

Drivers see their own lanes highlighted with a **teal border glow** and a **YOU** badge.

---

### 📡 Near — Bluetooth + Local Mesh + Geohash Rooms

This is the most technically interesting tab. It has three layers:

**1. Radar proximity view**
A pulsing radar where you're at the centre and every nearby peer, lane, and Bluetooth device orbits at its **real Haversine distance**. Tap any bubble to open a chat.

**2. Local Steeradar room (geohash-based mesh)**
Your GPS coordinates are hashed into a **6-character geohash** (≈1 km × 0.6 km precision). That geohash becomes a room prefix, and your browser claims one of **20 slots** under that prefix using PeerJS. Everyone else in the same geohash joins the same virtual room — **without any server**.

- Auto-rescans every 30 seconds
- Re-scans on tab focus
- Broadcast message to everyone via the FAB
- Leave/join automatically when you cross into a new neighbourhood

**3. Real Web Bluetooth scan**
Click **Scan** and your browser opens the native Bluetooth device chooser (`navigator.bluetooth.requestDevice()`). Connect, disconnect, and see RSSI (simulated — browsers don't expose real RSSI yet).

---

### 🐝 Hive — Community Board

A private neighbourhood feed stored entirely in `localStorage`, scoped per vehicle.

- **Stories row** — your published lanes appear as tappable stories
- **Greeting card** — time-aware greeting ("Good evening, Sai 👋")
- **Local posts** — write posts with the FAB, likes persist across reloads
- **Community poll** — "Favourite bus stop upgrade?" with animated bars

---

### 💬 Peer Chat (Real WebRTC)

Every vehicle number becomes a **PeerJS peer ID**. When you tap **Chat** on any lane, your browser dials the other browser directly — no message ever touches a server.

- Real-time peer-to-peer data channel
- 6-second connection timeout with graceful "peer offline" message
- Auto-reconnect on `unavailable-id` collisions
- Browser notifications for incoming messages when the tab is hidden
- System bubbles for connect/disconnect events

---

### 🤖 RAGina Pro AI — Voice, Music, Memory

Steeradar integrates [**RAGina**](https://github.com/suryasticsai/RAGina) — my open-source AI assistant — as a floating orb FAB.

- 🎵 **Music player** — YouTube-powered with full playback controls
- 🎤 **Speech recognition** — talk to her directly
- 🔊 **Text-to-speech** — she replies out loud
- 🧠 **Persistent memory** — remembers you across reloads (IndexedDB)
- 🎭 **7 expressive moods** with animated eyes
- 📜 **Selected-text awareness** — highlight anything and ask
- 📎 **File attachments** — drop PDFs, images, text

Ask her for route suggestions, fare estimates, or what your neighbourhood is talking about.

---

### 🔐 Privacy-First Design

- **No server** — everything runs in your browser
- **No login** — your vehicle number is your identity, stored locally
- **No tracking** — no analytics, no cookies, no third parties
- **No data leaves your device** unless you tap Publish or Send

**[↑ Back to top](#steeradar)**

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Markup** | HTML5 | Structure |
| **Styling** | Vanilla CSS | Custom design system with CSS variables |
| **Logic** | Vanilla JavaScript (ES2020) | No framework, no build step |
| **Maps** | [Leaflet 1.9.4](https://leafletjs.com/) + [MapLibre GL](https://maplibre.org/) | Map engine |
| **Tiles** | [OpenFreeMap](https://openfreemap.org/) | Free, keyless vector tiles |
| **Geocoding** | [Nominatim (OSM)](https://nominatim.org/) | Reverse geocoding |
| **Chat** | [PeerJS 1.5.2](https://peerjs.com/) | WebRTC signalling |
| **Proximity** | Custom geohash + PeerJS slots | Serverless mesh |
| **Bluetooth** | Web Bluetooth API | Device discovery |
| **AI** | [RAGina Pro](https://github.com/suryasticsai/RAGina) | Voice, music, memory |
| **Storage** | `localStorage` | Per-vehicle persistence |
| **Hosting** | GitHub Pages | Free static hosting |

**Total dependencies: 5 CDN scripts, 0 npm packages, 0 build tools.**

**[↑ Back to top](#steeradar)**

---

## 🚀 Quick Start

### Option 1 — Use it live

👉 **[https://suryasticsai.github.io/Steeradar/](https://suryasticsai.github.io/Steeradar/)**

Enter your vehicle number and start posting lanes.

### Option 2 — Run locally

```bash
git clone https://github.com/suryasticsai/Steeradar.git
cd Steeradar
python3 -m http.server 8000
# or: npx serve .
```

Open `http://localhost:8000` — that's it. No `npm install`, no build step.

> ⚠️ **Note:** Web Bluetooth and Geolocation require `https://` or `localhost`. GitHub Pages is HTTPS, so the live demo works.

### Option 3 — Deploy your own fork

1. Fork this repo
2. **Settings → Pages → Source: `main` / root**
3. Live in ~30 seconds at `https://<your-username>.github.io/Steeradar/`

**[↑ Back to top](#steeradar)**

---

## 🏗️ Architecture

```
Steeradar/
├── index.html      # Structure only — no inline logic
├── styles.css      # Full design system + responsive layout
├── app.js          # All logic, wrapped in an IIFE
└── README.md       # You are here
```

### How the three peer layers work

```
┌─────────────────────────────────────────────────────────┐
│  PEER A — Vehicle ID                                    │
│  steeradar-veh-<VEHICLE>                                │
│  Used for: Lane chats (per-driver direct connection)    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  PEER B — Geohash Room Slot                             │
│  steeradar-loc-<geohash>-<slot 1..20>                   │
│  Used for: Local mesh (auto-forms around your ~1km area)│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  PEER C — Bluetooth                                     │
│  navigator.bluetooth.requestDevice()                    │
│  Used for: Hardware discovery, RSSI display, GATT       │
└─────────────────────────────────────────────────────────┘
```

### Data flow

```
GPS → geohash(6) → room prefix → claim slot 1..20
                                       ↓
                          scan all other slots every 30s
                                       ↓
                    on connect → exchange hello packets
                                       ↓
                          broadcast chat to all peers
```

**[↑ Back to top](#steeradar)**

---

## 🎨 Design Language

| Token | Value | Usage |
|---|---|---|
| Background | `#0F1115` | Near-black base |
| Surface | `rgba(26,30,40,0.72)` | Glass cards |
| Teal | `#00E5C3` | Live status, primary accent |
| Coral | `#FF6B4A` | Alerts, fares, full lanes |
| Lime | `#A8E063` | Success, polls |
| Purple | `#A29BFE` | RAGina AI, Bluetooth |
| Radius | `18px` | Cards, buttons |
| Blur | `blur(20px)` | Glass surfaces |

**Typography**: System fonts (`-apple-system`, `Inter`, `SF Pro`) — no web fonts for zero-latency rendering.

**Motion**: Every interaction uses a 150–300ms ease. Bus markers pulse. Occupancy rings fill. Cards slide. Nothing snaps.

**[↑ Back to top](#steeradar)**

---

## 🗺️ Roadmap

- [x] Vehicle gate & validation
- [x] Live community map
- [x] WebRTC lane chats
- [x] Geohash local mesh
- [x] Bluetooth scan
- [x] RAGina Pro AI integration
- [x] Hive community board
- [ ] Service worker for offline mode
- [ ] Encrypted local storage
- [ ] Multi-language support
- [ ] Ride history & receipts
- [ ] Driver reputation system
- [ ] Group fare splitting
- [ ] Native PWA install
- [ ] Own PeerServer for production scale

**[↑ Back to top](#steeradar)**

---

## 🤝 Contributing

Contributions are welcome and encouraged. Steeradar is intentionally kept simple — vanilla stack, no build tools, three files — so anyone can read it in one sitting.

```bash
# Fork → clone → branch → commit → push → PR
git checkout -b feature/amazing-idea
git commit -m "Add amazing idea"
git push origin feature/amazing-idea
```

Open a PR and let's talk.

**Please consider:**

- 🐛 Bug reports with browser + device info
- 💡 Feature ideas with mockups if possible
- 📚 Documentation improvements
- 🧪 Testing on mobile browsers (iOS Safari, Chrome Android)

---

## 👤 About the Maker

<div align="center">

<img src="https://avatars.githubusercontent.com/suryasticsai" alt="@suryasticsai" width="120" height="120" style="border-radius: 50%;" />

### **Sai Varakala ☀️**

**Techno Agilist · SAFe Scrum Master @ TCS**

</div>

Hi, I'm **Sai** — a techno-functional agilist by day, tinkerer by night. I build open-source tools that solve small, real problems for real people: neighbourhood ride networks, offline-first AI assistants, privacy-respecting utilities.

Steeradar started as a weekend thought experiment — *"Can a whole ride-sharing app work without a backend?"* — and turned into a full peer-to-peer mesh built entirely with the browser's native capabilities.

I believe **good software should be forkable**, **readable in one sitting**, and **deployable by anyone with a GitHub account**. That's the guiding principle behind everything I publish.

If Steeradar saves you a bus fare, sparkles an idea, or teaches you a thing about WebRTC — mission accomplished.

> ⭐ **Star the repo if you found it useful** — it genuinely helps!

---

## 📬 Connect

<div align="center">

| Platform | Link |
|---|---|
| 💼 **LinkedIn** | [linkedin.com/in/suryasticsai](https://www.linkedin.com/in/suryasticsai) |
| 📝 **Medium** | [suryasticsai.medium.com](https://suryasticsai.medium.com) |
| 🐙 **GitHub** | [github.com/suryasticsai](https://github.com/suryasticsai) |
| 🤗 **HuggingFace** | [huggingface.co/spaces/Suryasticsai](https://huggingface.co/spaces/Suryasticsai) |
| 📷 **Instagram** | [instagram.com/saisuryastic](https://instagram.com/saisuryastic) |
| ✉️ **Email** | [suryasticsai@gmail.com](mailto:suryasticsai@gmail.com) |

**Everything at one handle → `@suryasticsai`**

</div>

---

## 📜 License

MIT © [Sai Varakala](https://github.com/suryasticsai)

Free to use, fork, remix, and ship — attribution appreciated but not required.

---

## 🙏 Acknowledgements

Built with love on the shoulders of these open-source giants:

- [Leaflet](https://leafletjs.com/) — the friendliest map library on the web
- [MapLibre GL](https://maplibre.org/) — the open vector map engine
- [OpenFreeMap](https://openfreemap.org/) — free, keyless vector tiles
- [PeerJS](https://peerjs.com/) — WebRTC made human
- [OpenStreetMap](https://www.openstreetmap.org/) — the free world map
- [Nominatim](https://nominatim.org/) — reverse geocoding for everyone
- [RAGina](https://github.com/suryasticsai/RAGina) — my own AI companion

---

<div align="center">

### 🌟 If you made it this far — thank you.

**Steeradar** isn't just a project. It's a bet that the web can be simpler, fairer, and more local.

**[⭐ Star on GitHub](https://github.com/suryasticsai/Steeradar)** · **[🚀 Try Live](https://suryasticsai.github.io/Steeradar/)** · **[💬 Say Hi](mailto:suryasticsai@gmail.com)**

<br>

**[↑ Back to top](#steeradar)**

<sub>Made with ☀️ by <a href="https://github.com/suryasticsai">@suryasticsai</a></sub>

</div>