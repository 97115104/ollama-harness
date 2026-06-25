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

The script installs every dependency, detects your GPU, pulls the model, and opens a browser window.

---

## What you get

- **Web-based model picker**: choose from Mistral 7B, Qwen 2.5, Phi-4 Mini, TinyLlama, Llama 3.x, and more
- **Chat interface**: polished dark UI, streaming responses, conversation history
- **Voice interface**: generate responses and read them aloud with browser TTS
- **Admin dashboard**: create/manage API keys, view request logs, change passwords
- **OpenAI-compatible API**: works with any client that supports the OpenAI SDK
- **Cloudflare Quick Tunnel**: instant remote access, no account required, no port forwarding
- **Ollama-backed inference**: pulls and runs models via Ollama with Metal/CUDA/CPU acceleration

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
| Arch Linux | NVIDIA (CUDA) | ✅ Full support |
| Fedora 36+ / RHEL 9+ | NVIDIA (CUDA) | ✅ Full support |
| macOS 13+ (Apple Silicon) | Metal | ✅ Full support |
| Linux / Windows | NVIDIA (CUDA) | ✅ Full support |

---

## Quick architecture overview

```
deploy-locally.sh
  └── docker compose up
        ├── inference-studio-web   (Next.js, port 3000)
        │     ├── /             Dashboard + model picker
        │     ├── /chat         Streaming chat UI
        │     ├── /voice        Voice interface
        │     └── /admin        API key management
        │
        └── inference-studio-api   (Hono, port 3001)
              ├── SQLite DB      (API keys, requests, settings)
              └── Ollama proxy   (OpenAI-compatible /v1/*)

  Ollama (host, port 11434)      (pulls and serves models)

  cloudflared tunnel → https://xxx.trycloudflare.com → port 3000
```
