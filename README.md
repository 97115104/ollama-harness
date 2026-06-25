# Inference Studio

Self-hosted Ollama inference with a web interface and OpenAI-compatible API.

```bash
git clone https://github.com/your-org/ollama-harness
cd ollama-harness
bash deploy-locally.sh
```

The script installs Docker and Ollama if absent, builds the services, and opens `http://localhost:3000`, where you pick a model and wait for it to load. The endpoint is then live locally and via an automatically started Cloudflare Quick Tunnel, with no account and no port forwarding required. The API follows the OpenAI chat completions format at `/v1`—see [Using the API](guides/using-the-api.md) for how to connect external clients (base URL `http://localhost:3000/v1`, API key from `/admin`, model `default`). Default credentials are **admin** / **password** and should be changed immediately at `/admin`.

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
