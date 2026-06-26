---
layout: default
title: Customization
nav_order: 4
---

# Customization

## Changing admin credentials

Edit `.env` before the first run, or via **Admin → Settings** after:

```bash
# .env
ADMIN_USERNAME=myname
ADMIN_PASSWORD=my-secure-password-here
JWT_SECRET=a-long-random-string-for-signing-jwt-tokens
```

After editing `.env`, restart the services:
```bash
docker compose down && docker compose up -d
```

## Changing ports

Edit `.env` and `docker-compose.yml`:

```yaml
# docker-compose.yml
services:
  web:
    ports:
      - "8080:3000"   # expose web on 8080 instead of 3000
  api:
    ports:
      - "8081:3001"   # expose API on 8081
```

Also update the `deploy-locally.sh` constants at the top:
```bash
WEB_PORT=8080
API_PORT=8081
```

## Adding models

### Option 1: Any Ollama model (no code changes)

On the dashboard or **Admin → Models**, use the **Or use any Ollama model** field. Enter a tag from [ollama.com/search](https://ollama.com/search), for example:

- `gpt-oss:20b`
- `qwen3.5:9b`
- `gemma4:12b`
- `lfm2.5`

The API validates the tag format and Ollama pulls it automatically.

### Option 2: Add to the curated list

Edit `api/src/routes/setup.ts` and add an entry to the `MODELS` array. For Ollama-native models, use the Ollama tag as the `id`:

```typescript
{
  id: "gpt-oss:20b",
  name: "GPT-OSS 20B",
  description: "OpenAI's open-weight reasoning model",
  params: "20B", vram_gb: 16, vram_int8_gb: 16, context_k: 128,
  tags: ["reasoning", "openai", "ollama"],
  no_auth: true,
},
```

For HuggingFace-style IDs, also add a mapping in `api/src/lib/ollama.ts` (`HF_TO_OLLAMA` and optionally `OLLAMA_MODELS` for context length).

Rebuild and restart:
```bash
docker compose build api && docker compose up -d api
```

## GPU access (NVIDIA)

On systems with an NVIDIA GPU, `deploy-locally.sh` automatically runs:

```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
```

The override adds `gpus: all` to the Ollama container. Requires the NVIDIA Container Toolkit (installed by the deploy script).

To run manually with GPU:
```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
```

CPU-only (no NVIDIA override):
```bash
docker compose up -d
```

## Model cache location

Ollama stores downloaded models in the `ollama_data` Docker volume. To use a host path instead (e.g. fast NVMe):

```yaml
# docker-compose.yml
services:
  ollama:
    volumes:
      - /fast/nvme/ollama:/root/.ollama
```

Remove the `ollama_data` entry from the `volumes:` section at the bottom if you no longer use the named volume.

## Persistent Cloudflare tunnel (named tunnel)

By default the tunnel URL changes on every restart. For a permanent URL:

1. Create a free Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Add your domain (or use a free subdomain via Cloudflare Pages)
3. Create a named tunnel:
   ```bash
   cloudflared tunnel create inference-studio
   cloudflared tunnel route dns inference-studio your-subdomain.example.com
   ```
4. Add to your tunnel config (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: your-subdomain.example.com
       service: http://localhost:3000
     - service: http_status:404
   ```
5. Run: `cloudflared tunnel run inference-studio`

## Running without Docker (advanced)

If you prefer to run natively, install Ollama on the host and point the API at it:

```bash
# Terminal 1 - Ollama on host
ollama serve

# Terminal 2 - API
cd api
npm install
DATA_DIR=../data OLLAMA_URL=http://localhost:11434 ADMIN_PASSWORD=password npm run dev

# Terminal 3 - Web
cd web
npm install
API_URL=http://localhost:3001 npm run dev
```

This bypasses the containerized stack and is only recommended for development.

## Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USERNAME` | `admin` | Admin login username |
| `ADMIN_PASSWORD` | `password` | Admin login password |
| `JWT_SECRET` | `inference-studio-change-me...` | JWT signing secret |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama API URL (internal Docker service name) |
| `DATA_DIR` | `./data` | SQLite database location |
| `GPU_TYPE` | `cpu` | Hardware profile: `nvidia`, `metal`, or `cpu` |

Override `OLLAMA_URL` only if using an external Ollama instance instead of the bundled container.
