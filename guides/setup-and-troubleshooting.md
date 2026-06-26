# Inference Studio: Setup & Troubleshooting

## Quick start

```bash
git clone https://github.com/your-org/ollama-harness
cd ollama-harness
bash deploy-locally.sh
```

The script installs Docker (and the NVIDIA Container Toolkit if needed), builds all containers, and opens the web UI. **Nothing else needs to be installed on the host** — Ollama runs inside Docker.

---

## What the script does

| Step | What happens |
|------|-------------|
| OS detection | Identifies macOS, Debian/Ubuntu, Arch/CachyOS, or Fedora |
| Dependency install | Installs Docker, NVIDIA Container Toolkit (if NVIDIA GPU), cloudflared |
| GPU detection | Finds NVIDIA GPU, Apple Silicon, or CPU-only |
| Docker build | Builds `ollama`, `api`, and `web` containers (~2–5 min first run) |
| Service start | Starts all three containers; waits for Ollama health check |
| Tunnel | Opens a free Cloudflare Quick Tunnel on trycloudflare.com |
| Browser | Opens http://localhost:3000 automatically |

---

## System requirements

### Minimum (CPU mode)
- 16 GB RAM
- 20 GB free disk space (Docker images + model cache)
- Docker 24+
- macOS 12+, Ubuntu 20.04+, Arch, or Fedora 36+

### Recommended (GPU mode)
- NVIDIA GPU with 8+ GB VRAM (16+ GB for 7B models; ~16 GB for GPT-OSS 20B)
- Ubuntu 22.04 / Debian 12 / Arch / Fedora 38+
- NVIDIA driver 525+ (`nvidia-smi` should work before running the script)

### macOS (Apple Silicon)
- macOS 13+ with M1/M2/M3/M4
- 16+ GB unified memory
- Docker Desktop installed and running
- Ollama runs in Docker on CPU (GPU passthrough is not available in macOS containers)

---

## First-run model selection

After the script starts the services, your browser opens to `http://localhost:3000`. If no model is deployed yet, you'll see the model picker:

1. **Choose a model** from the top list, or click "View more" for the full curated list
2. **Or enter any Ollama tag** from [ollama.com/search](https://ollama.com/search) (e.g. `gpt-oss:20b`, `qwen3.5:9b`)
3. Click **Deploy**. The Ollama container pulls the model and loads it into memory
4. Wait for the green "running" indicator — large models may take 5–15 minutes to download on first deploy

**VRAM guidance:**

| Model | VRAM needed |
|-------|------------|
| TinyLlama 1.1B | 2 GB |
| Phi-4 Mini 3.8B | 8 GB |
| Mistral 7B / Qwen 7B | 14 GB |
| GPT-OSS 20B | ~16 GB (MXFP4) |
| GPT-OSS 120B | ~80 GB |

---

## Generating API keys

1. Open `http://localhost:3000/admin` (or click **Admin** in the navbar)
2. Log in with **admin** / **password** (change this immediately!)
3. Go to the **Keys** tab
4. Enter a name, click **+ Create key**
5. Copy the key (shown once only)

API keys look like: `sk-studio-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## Using the API

Inference Studio exposes an **OpenAI-compatible API**. Any client that works with OpenAI will work here. Just change the base URL and API key.

Use **`default`** as the model name to target whatever is currently deployed — you don't need the HuggingFace ID or Ollama tag.

### cURL example

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-studio-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Explain quantum entanglement simply."}],
    "stream": true
  }'
```

### Python (openai library)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-studio-YOUR_KEY",
)

response = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### Remote access via Cloudflare tunnel

Replace `http://localhost:3000` with the tunnel URL shown on your dashboard:

```bash
curl https://xxx-yyy-zzz.trycloudflare.com/v1/chat/completions \
  -H "Authorization: Bearer sk-studio-YOUR_KEY" \
  ...
```

The tunnel URL changes every time you restart the script. Share it with your API key for remote access. No port forwarding needed.

---

## Troubleshooting

### "Docker is not running"

```bash
# Linux - start Docker
sudo systemctl start docker

# macOS - open Docker Desktop from Applications, wait for it to start
open -a Docker
```

### "Cannot access Docker socket"

```bash
sudo chmod 666 /var/run/docker.sock
# Or add your user to the docker group (requires re-login):
sudo usermod -aG docker $USER
newgrp docker
```

### NVIDIA GPU not detected in Docker

1. Verify the driver works: `nvidia-smi`
2. Reinstall the toolkit:
   ```bash
   sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
3. Test: `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi`
4. Restart with GPU override:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
   ```

### Deploy shows "fetch failed" but diagnostics say Ollama is reachable

This usually means a **stale error from a previous attempt** (before Ollama was running in Docker). Fix:

1. Click **Retry** on the deploy error screen, or
2. Restart the stack: `docker compose up -d --build`

The API clears stale error state on startup. After restart, pick your model and deploy again.

### Model download is slow or stuck

Large models (e.g. `gpt-oss:20b` at ~14 GB) take several minutes on first deploy. The deploy log shows download percentage. To monitor:

```bash
docker compose logs -f ollama
docker compose logs -f api
```

### Ollama pull succeeds but model never loads

```bash
# Check Ollama container logs
docker compose logs ollama --tail 50

# List models in the container
docker exec inference-studio-ollama ollama list

# Check what's loaded in memory
docker exec inference-studio-ollama ollama ps
```

Common causes:
- Insufficient RAM/VRAM for the model → try a smaller model (Phi-4 Mini or TinyLlama)
- Ollama container not healthy → `docker compose ps` should show `healthy` for `inference-studio-ollama`
- Out of disk space → `docker system df`

### Web UI shows "no model active" even after deploying

1. Check API logs: `docker compose logs api`
2. Check deploy status: `curl -s http://localhost:3001/setup/status | jq`
3. Verify Ollama has the model: `docker exec inference-studio-ollama ollama list`
4. Check Ollama diagnostics: `curl -s http://localhost:3001/setup/diagnostics | jq`

### External apps (Write Like Me, etc.) return 404

The web **`/chat`** page and third-party OpenAI clients use different model names. `/chat` sends the deployed model ID; apps like [Write Like Me](https://97115104.github.io/writelikeme/) should use model **`default`** and base URL **`http://localhost:3000/v1`** (not `/chat`).

If you see `404 Endpoint not found` while `/chat` still works, see [Using the API — Troubleshooting](using-the-api.md#external-clients-write-like-me-open-webui-etc).

### Cloudflare tunnel fails to start

The tunnel is optional. If it doesn't start:
- Your instance still works locally at `http://localhost:3000`
- To manually start a tunnel: `cloudflared tunnel --url http://localhost:3000`
- The tunnel URL is temporary. It changes every restart. For a permanent URL, [create a free Cloudflare account](https://dash.cloudflare.com/sign-up) and set up a named tunnel.

### Admin login doesn't work

Default credentials: **admin** / **password**

If you've forgotten a changed password, reset via the command line:

```bash
# Stop services
docker compose stop

# Delete the database to reset all settings (⚠ this deletes API keys too)
rm data/studio.db

# Restart
docker compose up -d
```

Or set a new password via the API directly:

```bash
# First get a token with the current password
TOKEN=$(curl -s -X POST http://localhost:3001/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"OLD_PASSWORD"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# Then change it
curl -X POST http://localhost:3001/admin/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current":"OLD_PASSWORD","new":"NEW_PASSWORD"}'
```

### Services stop when I close the terminal

Run in a persistent session:

```bash
# Using screen
screen -S inference-studio
bash deploy-locally.sh
# Detach: Ctrl+A then D
# Reattach: screen -r inference-studio

# Using tmux
tmux new -s inference-studio
bash deploy-locally.sh
# Detach: Ctrl+B then D
# Reattach: tmux attach -t inference-studio

# Using nohup
nohup bash deploy-locally.sh &>/var/log/inference-studio.log &
```

Or run containers in the background without the script:

```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
```

### Port conflicts

If ports 3000 or 3001 are already in use:

```bash
# Find what's using the port
sudo lsof -i :3000

# Edit docker-compose.yml to change the ports, then restart
docker compose up -d
```

---

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml build --pull
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
```

On CPU-only systems, omit the `-f docker-compose.nvidia.yml` flag.

---

## Uninstalling

```bash
# Stop and remove containers
docker compose down

# Remove model cache and other volumes
docker volume rm inference-studio_ollama_data 2>/dev/null || true
docker volume prune

# Remove data directory (API keys, request history)
rm -rf data/
```

Remove unused Docker images:

```bash
docker rmi inference-studio-api inference-studio-web ollama/ollama:latest
```
