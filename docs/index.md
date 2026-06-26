---
layout: default
title: Inference Studio
nav_order: 1
---

# Inference Studio

**Run any open-source LLM on your own hardware. One command, polished web interface, instant remote access.**

```bash
git clone https://github.com/your-org/ollama-harness
cd ollama-harness
bash deploy-locally.sh
```

The script installs Docker, detects your GPU, starts all services in containers, and opens a browser window.

---

## What you get

- **Web-based model picker**: choose from Mistral 7B, Qwen 2.5, Phi-4 Mini, GPT-OSS 20B, Llama 3.x, and more
- **Any Ollama model**: enter a tag from [ollama.com/search](https://ollama.com/search) (e.g. `qwen3.5:9b`, `gemma4:12b`)
- **Chat interface**: polished dark UI, streaming responses, conversation history
- **Voice interface**: generate responses and read them aloud with browser TTS
- **Admin dashboard**: create/manage API keys, view request logs, change passwords
- **OpenAI-compatible API**: works with any client that supports the OpenAI SDK
- **Cloudflare Quick Tunnel**: instant remote access, no account required, no port forwarding
- **Fully containerized**: Ollama, API, and web UI all run via Docker Compose

---

## Navigation

- [Features](features.md) - full feature list and capability overview
- [Using the API](completions.md) - chat completions, streaming, SDK examples, integrations
- [API Reference](api-reference.md) - full endpoint reference and admin API
- [Customization](customization.md) - changing models, ports, credentials, and more
- [Setup Guide](../guides/setup-and-troubleshooting.md) - installation, troubleshooting
- [API Usage Guide](../guides/using-the-api.md) - connecting clients, remote access, common integrations

---

## Supported platforms

| Platform | GPU | Status |
|----------|-----|--------|
| Ubuntu 20.04+ / Debian 11+ | NVIDIA (CUDA) | ✅ Full support |
| Arch Linux / CachyOS | NVIDIA (CUDA) | ✅ Full support |
| Fedora 36+ / RHEL 9+ | NVIDIA (CUDA) | ✅ Full support |
| macOS 13+ (Apple Silicon) | CPU in Docker | ✅ Works (no GPU passthrough in containers) |
| Linux / Windows | NVIDIA (CUDA) | ✅ Full support |

On Linux with an NVIDIA GPU, `deploy-locally.sh` automatically applies `docker-compose.nvidia.yml` so the Ollama container gets GPU access.

---

## Quick architecture overview

```
deploy-locally.sh
  └── docker compose up
        ├── inference-studio-ollama   (Ollama, internal :11434)
        │     └── ollama_data volume  (model cache, persistent)
        │
        ├── inference-studio-api      (Hono, port 3001)
        │     ├── SQLite DB           (API keys, requests, settings)
        │     └── Ollama proxy        (OpenAI-compatible /v1/*)
        │
        └── inference-studio-web      (Next.js, port 3000)
              ├── /             Dashboard + model picker
              ├── /chat         Streaming chat UI
              ├── /voice        Voice interface
              └── /admin        API key + model management

  cloudflared tunnel → https://xxx.trycloudflare.com → port 3000
```

Nothing needs to be installed on the host except Docker. The deploy script optionally installs `cloudflared` for the Quick Tunnel.
