---
layout: default
title: Features
nav_order: 2
---

# Features

## Deploy script (`deploy-locally.sh`)

### OS & hardware support
- Detects macOS, Debian/Ubuntu, Arch Linux, Fedora/RHEL automatically
- Identifies NVIDIA GPU + VRAM, Apple Silicon, or CPU-only
- Installs Docker Engine, NVIDIA Container Toolkit (when NVIDIA GPU found), and cloudflared
- Requests sudo only once; keeps the session alive during the install
- Applies `docker-compose.nvidia.yml` automatically when an NVIDIA GPU is detected

### Dependency installation
Every package installation shows a named spinner so you know exactly what is being installed:
```
   ⣾  Installing nvidia-container-toolkit…
   ✓  Installing nvidia-container-toolkit
```

**No host Ollama install.** Ollama runs inside the `inference-studio-ollama` container.

### Ollama model deployment
- Curated model list in the UI (Mistral, Qwen, Phi, Llama, GPT-OSS, and more)
- **Custom Ollama models**: enter any tag from [ollama.com/search](https://ollama.com/search)
- Deployment progress with percentage during download
- Deploy log and Ollama diagnostics panel on the dashboard
- Retry button when a previous deploy failed but Ollama is healthy
- Stale error state cleared automatically on API restart

Models are pulled into the `ollama_data` Docker volume and served by the Ollama container. The API proxies Ollama's OpenAI-compatible `/v1` endpoints and tracks deployment progress in SQLite.

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
- **Model picker wizard** when no model is running: top models with VRAM requirements, expandable full list, and custom Ollama tag input

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
- Full list of curated models with params and VRAM requirements
- **Deploy any Ollama model** input (browse [ollama.com/search](https://ollama.com/search))
- Deploy / stop buttons
- Live deployment status (pulling → starting → running)
- Deploy log and Ollama diagnostics (URL, latency, version, cached model count)
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

### Setup endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/setup/status` | GET | — | Ollama status, deploy logs, tunnel URL |
| `/api/setup/diagnostics` | GET | — | Probe Ollama (latency, version, model count) |
| `/api/setup/models` | GET | — | Curated model list |
| `/api/setup/deploy` | POST | JWT | Deploy a model (curated ID or Ollama tag) |
| `/api/setup/stop` | POST | JWT | Stop loaded model |
| `/api/setup/cancel` | POST | JWT | Cancel in-progress deployment |
| `/api/setup/logs` | GET | JWT | SSE stream of deployment progress |
| `/api/setup/tunnel` | POST | JWT | Register tunnel URL |
