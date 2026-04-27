<div align="center">

# ◉ ProCast

### Record, Collaborate, and Enhance Your Podcasts

A full-stack, real-time podcast & meeting recording platform with multi-participant video calls, AI-powered transcription, intelligent summaries, multi-language translation, and a cloud-based video library.

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-procast--v2.netlify.app-00C896?style=for-the-badge)](https://procast-v2.netlify.app/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Live Demo](#-live-demo)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [API Reference](#-api-reference)
- [Database Schema](#-database-schema)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Overview

**ProCast** is an end-to-end podcasting and meeting platform that lets creators host multi-participant video sessions, record them in studio quality, and automatically generate AI transcripts, summaries, and action items — all from a single dashboard.

The platform captures each participant's audio/video independently using **Agora RTC**, uploads chunks to **Backblaze B2** cloud storage in real time, then merges them into a final grid video using **FFmpeg** on the server. After merging, an AI pipeline (Whisper + Gemini/OpenAI) transcribes the audio, generates a structured meeting summary, and makes everything accessible through a beautiful video library with translation support.

---

## 🌐 Live Demo

> **[https://procast-v2.netlify.app/](https://procast-v2.netlify.app/)**

Create an account and start recording immediately — no credit card required.

---

## ✨ Key Features

### 🎥 Real-Time Video Calls
- Multi-participant video conferencing powered by **Agora RTC SDK**
- Auto-detection of camera resolution (360p → 4K) with adaptive bitrate
- Google Meet-inspired UI with mic/camera toggles, participant avatars, and screen layout
- Host controls: start/stop recording, end meeting for all participants
- 5-digit meeting codes & shareable invite links for easy guest access

### 🔴 Studio-Quality Recording
- Each participant's audio + video is captured independently via `MediaRecorder`
- Chunks are uploaded to **Backblaze B2** in real time (every 5 seconds)
- **Single participant**: lossless stream-copy (no re-encoding) preserving original quality
- **Multi-participant**: native-resolution grid merge using FFmpeg with near-lossless CRF encoding (VP8/VP9)
- Individual participant video downloads available alongside the merged recording

### 🤖 AI Transcription & Summaries
- Automatic transcription via **Hugging Face Whisper** (large-v3) with segment-level timestamps
- Per-speaker diarization with intelligent overlap deduplication and cross-speaker conflict resolution
- **AI Meeting Summary** generation (key points, action items, decisions) via:
  - Google **Gemini** (default, free tier)
  - **OpenAI** GPT-4o-mini (fallback)
  - **Ollama** for local/self-hosted LLMs
- Long transcript chunking with hierarchical summarization

### 🌍 Multi-Language Translation
- Translate transcripts and summaries into **10+ languages** on the fly
- Supported: English, Hindi, Marathi, Sanskrit, Spanish, French, German, Portuguese, Arabic, Japanese
- Smart translation caching in MongoDB to avoid redundant API calls
- Batched translation with automatic provider failover (Gemini → OpenAI)

### 📚 Video Library
- Browse, search, stream, and download all past recordings
- Real-time processing pipeline status (video merge → transcript → summary)
- Auto-refreshing cards when recordings are still processing
- In-browser video playback with inline streaming
- Transcript viewer modal with language selector and meeting summary display
- Download individual participant recordings or the merged final video

### 👤 Authentication & Profiles
- JWT-based authentication with secure password hashing (bcrypt)
- User registration, login, and profile management
- Protected routes for library, profile, and call pages

---

## 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** | UI framework (via Vite) |
| **React Router 7** | Client-side routing |
| **Agora RTC SDK** | Real-time video/audio communication |
| **Framer Motion** | Page transitions and animations |
| **Lucide React** | Icon library |
| **Axios** | HTTP client for API calls |
| **Socket.IO Client** | Real-time event communication |
| **Tailwind CSS 4** | Utility-first styling |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js + Express 5** | REST API server |
| **MongoDB + Mongoose 9** | Database and ODM |
| **Agora Access Token** | Secure token generation for video calls |
| **FFmpeg (fluent-ffmpeg)** | Video merging, audio extraction, grid layout |
| **Backblaze B2** | Cloud object storage for recordings |
| **JWT (jsonwebtoken)** | Authentication tokens |
| **bcryptjs** | Password hashing |
| **Multer** | File upload middleware |
| **Socket.IO** | Real-time bidirectional event communication |
| **CORS** | Cross-origin resource sharing middleware |
| **dotenv** | Environment variable management |
| **form-data** | Multipart form data for file uploads to external APIs |
| **Axios** | External API calls (Whisper, Gemini, OpenAI) |

### External Services
| Service | Purpose |
|---|---|
| **Agora.io** | WebRTC infrastructure for video calls |
| **Backblaze B2** | Affordable cloud storage for video files |
| **Hugging Face** | Whisper ASR model for transcription |
| **Google Gemini** | AI summaries and translation |
| **OpenAI** | Fallback AI provider |
| **MongoDB Atlas** | Managed database hosting |
| **Netlify** | Frontend deployment |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React + Vite)                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Home    │  │ VideoCall │  │ Library  │  │ Auth (Login/  │  │
│  │  Page    │  │   Page    │  │  Page    │  │   Register)   │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                │          │
│       │         Agora RTC SDK       │                │          │
│       │      (Video/Audio Streams)  │                │          │
└───────┼──────────────┼──────────────┼────────────────┼──────────┘
        │              │              │                │
        ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js + Express)                  │
│                                                                 │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │  Auth API    │  │ Session API │  │  Library API           │  │
│  │  /api/auth/* │  │ /api/sess*  │  │  /api/library/*        │  │
│  └──────┬───────┘  └──────┬──────┘  └───────────┬────────────┘  │
│         │                 │                      │              │
│  ┌──────┴───────┐  ┌──────┴──────┐  ┌───────────┴────────────┐  │
│  │  JWT Auth    │  │  Upload &   │  │  Finalize Service      │  │
│  │  Middleware  │  │  Chunk Mgmt │  │  (FFmpeg Grid Merge)   │  │
│  └──────────────┘  └─────────────┘  └───────────┬────────────┘  │
│                                                  │              │
│                                     ┌────────────┴───────────┐  │
│                                     │  AI Pipeline           │  │
│                                     │  • Whisper (HF)        │  │
│                                     │  • Gemini / OpenAI     │  │
│                                     │  • Translation Cache   │  │
│                                     └────────────────────────┘  │
└──────────────┬──────────────────────────────────┬───────────────┘
               │                                  │
               ▼                                  ▼
        ┌──────────────┐                  ┌───────────────┐
        │  MongoDB     │                  │  Backblaze B2 │
        │  Atlas       │                  │  (Video/Audio │
        │  (Users,     │                  │   Storage)    │
        │   Sessions,  │                  └───────────────┘
        │   Chunks)    │
        └──────────────┘
```

---

## 📁 Project Structure

```
ProcastMain/
├── backend/
│   ├── src/
│   │   ├── app.js                          # Express app configuration & middleware
│   │   ├── server.js                       # Server entry point, route mounting, DB connection
│   │   ├── config/
│   │   │   ├── db.js                       # MongoDB connection setup
│   │   │   └── loadEnv.js                  # Environment variable loader
│   │   ├── controllers/
│   │   │   ├── agora.controller.js         # Agora token generation
│   │   │   ├── session.controller.js       # Session CRUD, participant management, recording state
│   │   │   ├── upload.controller.js        # Chunk upload handling
│   │   │   ├── finalize.controller.js      # Trigger post-session finalization
│   │   │   ├── library.controller.js       # Video library browsing, streaming, download
│   │   │   └── rebuildParticipant.controller.js  # Rebuild individual participant videos
│   │   ├── middleware/
│   │   │   └── auth.middleware.js           # JWT authentication middleware
│   │   ├── models/
│   │   │   ├── User.js                     # User schema (name, email, password, photo)
│   │   │   ├── Session.js                  # Session schema (channel, participants, transcript, summary)
│   │   │   ├── Chunk.js                    # Recording chunk schema (per-user, per-session)
│   │   │   ├── Recording.js                # Finalized recording metadata
│   │   │   └── TranslationCache.js         # Cached translations for deduplication
│   │   ├── routes/
│   │   │   ├── auth.routes.js              # POST /register, /login, GET /me
│   │   │   ├── agora.routes.js             # GET /token
│   │   │   ├── session.routes.js           # Session lifecycle routes
│   │   │   ├── upload.routes.js            # Chunk upload routes
│   │   │   ├── finalize.routes.js          # POST /finalize
│   │   │   ├── library.routes.js           # Library CRUD + streaming
│   │   │   └── rebuild.routes.js           # Participant video rebuild
│   │   ├── services/
│   │   │   ├── finalize.service.js         # FFmpeg grid merge + post-processing orchestrator
│   │   │   ├── transcription.service.js    # Whisper ASR via Hugging Face with chunk alignment
│   │   │   ├── aiSummaryService.js         # Meeting summary (Gemini / OpenAI / Ollama)
│   │   │   ├── translation.service.js      # Batched multi-provider translation with caching
│   │   │   ├── globalTranscriptMerge.js    # Multi-speaker transcript deduplication & sorting
│   │   │   ├── transcriptSentenceBuilder.js # Sentence-level transcript assembly
│   │   │   └── b2.service.js               # Backblaze B2 client wrapper
│   │   └── utils/
│   │       ├── b2.js                       # B2 upload/download helpers with retry logic
│   │       ├── ffmpeg.js                   # FFmpeg binary path configuration
│   │       └── layout.js                   # Grid layout calculation
│   ├── .env.example                        # Environment variable template
│   ├── package.json
│   └── nodemon.json
│
├── frontend/
│   └── procast-frontend/
│       ├── src/
│       │   ├── App.jsx                     # Root component with route definitions
│       │   ├── main.jsx                    # React DOM entry point
│       │   ├── index.css                   # Global styles
│       │   ├── api/
│       │   │   ├── axios.js                # Configured Axios instance with auth interceptor
│       │   │   ├── agora.js                # Agora token fetch helper
│       │   │   ├── session.js              # Session API helpers
│       │   │   └── upload.js               # Chunk upload API helper
│       │   ├── components/
│       │   │   ├── Navbar.jsx              # Global navigation bar
│       │   │   └── ProtectedRoute.jsx      # Auth guard wrapper
│       │   ├── pages/
│       │   │   ├── Home.jsx                # Landing page with animations & live stats
│       │   │   ├── Login.jsx               # Login form
│       │   │   ├── Register.jsx            # Registration form
│       │   │   ├── VideoCall.jsx           # Video call room (Agora + MediaRecorder)
│       │   │   ├── VideoLibrary.jsx        # Recording library with transcript viewer
│       │   │   ├── Profile.jsx             # User profile page
│       │   │   └── globals.css             # Page-specific global styles
│       │   └── utils/
│       │       ├── auth.js                 # Auth token helpers
│       │       └── agoraConfig.js          # Agora App ID config
│       ├── index.html
│       ├── vite.config.js
│       ├── netlify.toml                    # Netlify deploy configuration
│       └── package.json
│
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| **Node.js** | v18 or higher |
| **npm** | v9 or higher |
| **FFmpeg** | Bundled via `ffmpeg-static` (auto-installed) |
| **MongoDB** | Atlas (cloud) or local instance |
| **Git** | Latest |

You will also need accounts on:
- [**Agora.io**](https://www.agora.io/) — for real-time video communication
- [**Backblaze B2**](https://www.backblaze.com/b2/) — for cloud video storage
- [**Hugging Face**](https://huggingface.co/) — for Whisper transcription (free API)
- [**Google AI Studio**](https://aistudio.google.com/) — for Gemini API key (free tier available)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/HardikRaut26/procast_v2.git
cd procast_v2

# 2. Install backend dependencies
cd backend
npm install

# 3. Install frontend dependencies
cd ../frontend/procast-frontend
npm install
```

### Environment Variables

#### Backend (`backend/.env`)

Copy the example file and fill in your credentials:

```bash
cp backend/.env.example backend/.env
```

```env
# ─── Server ─────────────────────────────────────────────
PORT=5000
NODE_ENV=development

# ─── Database ───────────────────────────────────────────
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>?retryWrites=true&w=majority

# ─── Authentication ─────────────────────────────────────
JWT_SECRET=replace-with-a-long-random-secret

# ─── Agora (Video Calls) ────────────────────────────────
AGORA_APP_ID=your-agora-app-id
AGORA_APP_CERTIFICATE=your-agora-app-certificate

# ─── Backblaze B2 (Cloud Storage) ───────────────────────
B2_KEY_ID=your-b2-key-id
B2_APP_KEY=your-b2-app-key
B2_BUCKET_ID=your-b2-bucket-id
B2_BUCKET_NAME=your-b2-bucket-name

# ─── AI Transcription (Hugging Face) ────────────────────
HF_TOKEN=your-huggingface-token

# ─── AI Summaries ───────────────────────────────────────
# Set at least one. Gemini is preferred (free tier).
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=                          # optional fallback

# ─── Optional Tuning ────────────────────────────────────
# FINAL_VIDEO_CODEC=vp8                  # vp8 (default) or vp9
# FINAL_VIDEO_CRF=4                      # lower = higher quality
# MEDIA_CHUNK_DURATION_SECONDS=5
# WHISPER_LANGUAGE=                       # auto-detect by default
# AI_SUMMARY_PROVIDER=gemini             # gemini | openai | ollama
```

#### Frontend (`frontend/procast-frontend/.env`)

```env
VITE_API_URL=http://localhost:5000
```

### Running Locally

Open **two terminals**:

```bash
# Terminal 1 — Backend
cd backend
npm run dev          # Starts Express server with nodemon on port 5000

# Terminal 2 — Frontend
cd frontend/procast-frontend
npm run dev          # Starts Vite dev server (usually port 5173)
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📡 API Reference

### Authentication

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Register a new user |
| `POST` | `/api/auth/login` | Public | Login and receive JWT |
| `GET` | `/api/auth/me` | Private | Get current user profile |

### Sessions

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/sessions/start` | Private | Create a new live session |
| `POST` | `/api/sessions/stop` | Private | End a session (host only) |
| `POST` | `/api/sessions/join` | Private | Join an existing session |
| `POST` | `/api/sessions/leave` | Private | Leave a session |
| `POST` | `/api/sessions/broadcast-recording` | Private | Broadcast recording start/stop |
| `GET` | `/api/sessions/recording-state/:id` | Private | Get current recording state |
| `GET` | `/api/sessions/:id` | Private | Get session details & status |
| `GET` | `/api/sessions/:id/participants` | Private | List session participants |
| `POST` | `/api/sessions/:id/register-agora-uid` | Private | Map Agora UID to user |
| `GET` | `/api/sessions/:id/agora-uid-mapping` | Private | Get UID → user mapping |

### Uploads

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/uploads/chunk` | Private | Upload a recording chunk |

### Finalization

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/finalize` | Private | Trigger video merge & AI pipeline |

### Video Library

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/library` | Private | List all user recordings |
| `GET` | `/api/library/:sessionId/transcript` | Private | Get transcript (with optional `?lang=` translation) |
| `GET` | `/api/library/:fileId/download` | Private | Download a video file |
| `GET` | `/api/library/:fileId/stream` | Private | Stream a video inline |
| `DELETE` | `/api/library/:fileId` | Private | Delete a recording |

### Agora

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/agora/token` | Private | Generate Agora RTC token |

### Public

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/public-stats` | Public | Platform statistics (creators, recordings) |
| `GET` | `/health` | Public | Server health check |

---

## 🗄 Database Schema

### User
| Field | Type | Description |
|---|---|---|
| `name` | String | Full name (required) |
| `email` | String | Unique email (required) |
| `password` | String | Hashed password (min 6 chars) |
| `profilePhoto` | String | Profile photo URL |
| `createdAt` | Date | Auto-generated timestamp |

### Session
| Field | Type | Description |
|---|---|---|
| `channelName` | String | Agora channel identifier |
| `meetingCode` | String | 5-digit invite code |
| `host` | ObjectId → User | Session creator |
| `participants` | ObjectId[] → User | List of participants |
| `agoraUidMap` | Array | Maps Agora UIDs to user profiles |
| `participantFiles` | Map | userId → B2 file ID for individual videos |
| `startTime` / `endTime` | Date | Session timing |
| `status` | Enum | `LIVE` or `ENDED` |
| `recordingState` | Enum | `IDLE`, `START`, or `STOP` |
| `finalMeetingFileId` | String | B2 file ID for merged video |
| `transcriptFileId` | String | B2 file ID for `.txt` transcript |
| `transcript` | Array | Speaker-timestamped segments |
| `transcriptionStatus` | Enum | `NONE` / `RUNNING` / `SUCCEEDED` / `PARTIAL` / `FAILED` |
| `meetingSummary` | Object | AI-generated summary, key points, action items, decisions |

### Chunk
| Field | Type | Description |
|---|---|---|
| `sessionId` | ObjectId → Session | Parent session |
| `userId` | ObjectId → User | Uploader |
| `chunkIndex` | Number | Sequential chunk number |
| `fileName` | String | Original file name |
| `size` | Number | File size in bytes |
| `b2FileId` | String | Backblaze B2 file reference |
| `startTimeMs` | Number | Offset from recording start |

### TranslationCache
| Field | Type | Description |
|---|---|---|
| `sourceHash` | String | SHA-256 of source text |
| `sourceText` | String | Original text |
| `targetLanguage` | String | ISO language code |
| `translatedText` | String | Translated result |
| `provider` | String | Translation provider used |

---

## 🌐 Deployment

### Frontend (Netlify)

The frontend is pre-configured for Netlify deployment via `netlify.toml`:

```toml
[build]
  base = "frontend/procast-frontend"
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/api/*"
  to = "https://your-backend-url.com/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

1. Connect your GitHub repo to Netlify
2. Set the build base directory to `frontend/procast-frontend`
3. Set environment variables in the Netlify dashboard
4. Deploy

### Backend (Render / Railway / VPS)

```bash
cd backend
npm install
npm start            # Runs: node src/server.js
```

Ensure these are set in your hosting provider's environment:
- All variables from `.env.example`
- `NODE_ENV=production`

> **Note:** FFmpeg is bundled via `ffmpeg-static` — no system-level installation required.

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code patterns and directory structure
- Add JSDoc comments for new service functions
- Test the full pipeline locally before submitting PRs (record → finalize → transcript → summary)
- Keep `.env.example` updated when adding new environment variables

---

## 📄 License

This project is licensed under the **ISC License**.

---

<div align="center">

**Built with ❤️ by [Hardik Raut](https://github.com/HardikRaut26)**

[🌐 Live Demo](https://procast-v2.netlify.app/) · [🐛 Report Bug](https://github.com/HardikRaut26/procast_v2/issues) · [✨ Request Feature](https://github.com/HardikRaut26/procast_v2/issues)

</div>

