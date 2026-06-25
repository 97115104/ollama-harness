---
layout: default
title: Features
nav_order: 2
---

# Features

## Deploy script (`deploy-locally.sh`)

### OS & hardware support
- Detects macOS, Debian/Ubuntu, Arch Linux, Fedora/RHEL automatically
- Identifies NVIDIA GPU + VRAM, Apple Silicon (Metal), or CPU-only
- Installs Docker Engine, NVIDIA Container Toolkit, and cloudflared without manual steps
- Requests sudo only once; keeps the session alive during the install

### Dependency installation
Every package installation shows a named spinner so you know exactly what is being installed:
```
   ⣾  Installing nvidia-container-toolkit…
   ✓  Installing nvidia-container-toolkit
```

### Ollama model deployment
Models are pulled and served via Ollama on the host. The API proxies Ollama's OpenAI-compatible `/v1` endpoints and tracks deployment progress in SQLite.

### Cloudflare Quick Tunnel
- No Cloudflare account needed
- Runs `cloudflared tunnel --url http://localhost:3000`
- Parses the `trycloudflare.com` URL from the output
- Registers it with the API so the dashboard displays it immediately
- Tunnel URL updates in the web UI automatically

---

## Web interface

### Dashboard (`/`)
- Shows current model, engine (Ollama), and today's request count
- Displays the active Cloudflare tunnel URL with a copy button
- Quick-start API snippet
- Recent request log (for admins)
- **Model picker wizard** when no model is running: shows top 5 with VRAM requirements, expandable to full list

### Chat (`/chat`)
- Full-page streaming chat interface
- Markdown rendered in assistant replies
- Configurable system prompt
- API key + connection status indicator
- Stop button for in-flight requests
- Auto-scrolls to latest message
- Multi-line input (Shift+Enter for newline)

### Voice (`/voice`)
- LLM-powered text generation with a system prompt tuned for natural speech
- Browser-native TTS (Web Speech API), works offline, no TTS server needed
- Live waveform canvas: breathing animation at idle, frequency bars while speaking
- Voice picker + speed control
- Copy response to clipboard

### Admin (`/admin`)
Password-protected admin panel with four tabs:

**Models tab**
- Full list of available models with params and VRAM requirements
- Deploy / stop buttons
- Live deployment status (pulling → starting → running)
- Ollama deployment log streaming (SSE)
- HF token input for gated models

**Keys tab**
- Create API keys with optional name and email
- New key shown once with a copy button
- Enable / disable / delete keys
- "Copy key" for keys with stored raw values

**Requests tab**
- Last 50 requests: time, status, model, API key prefix, latency, tokens in/out, prompt preview

**Settings tab**
- Change admin password (requires current password)
- View active tunnel URL

---

## API

### Authentication
All `/v1/*` requests require `Authorization: Bearer <api-key>`. API keys are validated against a SHA-256 hash stored in SQLite.

### OpenAI-compatible endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completion (streaming supported) |
| `/v1/models` | GET | List loaded models |

### Admin endpoints (JWT)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/login` | POST | Get JWT token |
| `/api/admin/password` | POST | Change password |
| `/api/admin/keys` | GET | List API keys |
| `/api/admin/keys` | POST | Create API key |
| `/api/admin/keys/:id` | PATCH | Update key (active, name, scopes) |
| `/api/admin/keys/:id` | DELETE | Delete key |
| `/api/admin/requests` | GET | Request log |
| `/api/admin/settings` | GET/PATCH | Settings |

### Setup endpoints (JWT)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/setup/status` | GET | Ollama status + tunnel URL |
| `/api/setup/models` | GET | Available model list |
| `/api/setup/deploy` | POST | Deploy a model |
| `/api/setup/stop` | POST | Stop loaded model |
| `/api/setup/logs` | GET | SSE stream of Ollama deployment progress |
| `/api/setup/tunnel` | POST | Register tunnel URL |
