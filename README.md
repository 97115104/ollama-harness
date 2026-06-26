# Inference Studio

Self-hosted Ollama inference with a web interface and OpenAI-compatible API. **Everything runs in Docker** — no host Ollama install required.

```bash
git clone https://github.com/your-org/ollama-harness
cd ollama-harness
bash deploy-locally.sh
```

The script installs Docker (and the NVIDIA Container Toolkit if a GPU is detected), builds three containers (`ollama`, `api`, `web`), and opens `http://localhost:3000`. Pick a model from the list or enter any [Ollama library tag](https://ollama.com/search) (e.g. `gpt-oss:20b`, `qwen3.5:9b`), wait for it to download and load, then use the API.

A Cloudflare Quick Tunnel starts automatically for remote access — no account and no port forwarding required.

The API follows the OpenAI chat completions format at `/v1`. See [Using the API](guides/using-the-api.md) for connecting external clients (base URL `http://localhost:3000/v1`, API key from `/admin`, model `default`).

Default credentials are **admin** / **password** — change them immediately at `/admin`.

## What's included

| Container | Role |
|-----------|------|
| `inference-studio-ollama` | Pulls and runs models (GPU-enabled on NVIDIA when detected) |
| `inference-studio-api` | OpenAI-compatible API, deployment orchestration, SQLite DB |
| `inference-studio-web` | Dashboard, model picker, chat, admin panel |

Model weights persist in the `ollama_data` Docker volume across restarts.

## Documentation

- [Using the API](guides/using-the-api.md) — connect OpenAI-compatible clients (base URL, API key, model `default`)
- [Features](docs/features.md)
- [API Reference](docs/api-reference.md)
- [Customization](docs/customization.md)
- [Setup & Troubleshooting](guides/setup-and-troubleshooting.md)

## License

MIT

---

## Attestation

Verify: [attest.97115104.com/s/kia8myqz](https://attest.97115104.com/s/kia8myqz)
