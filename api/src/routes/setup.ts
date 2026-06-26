import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { adminAuth, type HonoVars } from "../middleware/auth.js";
import {
  deployModel,
  stopInference,
  cancelDeployment,
  getInferenceStatus,
  isDeploymentInProgress,
  inferenceLogs,
  isOllamaSupported,
  probeOllama,
} from "../lib/ollama.js";
import { checkInferenceHealth } from "../lib/inference.js";
import db from "../db/index.js";

export const MODELS = [
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct",
    description: "Fast, capable chat model from Mistral AI",
    params: "7B", vram_gb: 14, vram_int8_gb: 7, context_k: 32,
    tags: ["general", "chat", "coding"],
    no_auth: true,
  },
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B",
    description: "Alibaba's excellent multilingual model with long context",
    params: "7B", vram_gb: 14, vram_int8_gb: 7, context_k: 128,
    tags: ["multilingual", "long-context"],
    no_auth: true,
  },
  {
    id: "microsoft/Phi-4-mini-instruct",
    name: "Phi-4 Mini",
    description: "Microsoft's compact but highly capable instruction model",
    params: "3.8B", vram_gb: 8, vram_int8_gb: 4, context_k: 128,
    tags: ["efficient", "coding"],
    no_auth: true,
  },
  {
    id: "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    name: "TinyLlama 1.1B",
    description: "Smallest option — runs on nearly any hardware",
    params: "1.1B", vram_gb: 2, vram_int8_gb: 1, context_k: 2,
    tags: ["lightweight", "fast"],
    no_auth: true,
  },
  {
    id: "Qwen/Qwen2.5-14B-Instruct",
    name: "Qwen 2.5 14B",
    description: "More capable Qwen with 128K context",
    params: "14B", vram_gb: 28, vram_int8_gb: 14, context_k: 128,
    tags: ["multilingual", "large"],
    no_auth: true,
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    name: "DeepSeek R1 7B",
    description: "Strong reasoning via distillation of DeepSeek R1",
    params: "7B", vram_gb: 14, vram_int8_gb: 7, context_k: 128,
    tags: ["reasoning", "distill"],
    no_auth: true,
  },
  {
    id: "microsoft/Phi-3.5-mini-instruct",
    name: "Phi-3.5 Mini",
    description: "Compact model with 128K context window",
    params: "3.8B", vram_gb: 8, vram_int8_gb: 4, context_k: 128,
    tags: ["efficient"],
    no_auth: true,
  },
  {
    id: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    name: "SmolLM2 1.7B",
    description: "Ultra-lightweight, great for testing",
    params: "1.7B", vram_gb: 4, vram_int8_gb: 2, context_k: 8,
    tags: ["lightweight"],
    no_auth: true,
  },
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B",
    description: "Meta's flagship small model",
    params: "8B", vram_gb: 16, vram_int8_gb: 8, context_k: 128,
    tags: ["general", "popular"],
    no_auth: true,
  },
  {
    id: "meta-llama/Llama-3.2-3B-Instruct",
    name: "Llama 3.2 3B",
    description: "Meta's compact multilingual model",
    params: "3B", vram_gb: 6, vram_int8_gb: 3, context_k: 128,
    tags: ["compact"],
    no_auth: true,
  },
  {
    id: "Qwen/QwQ-32B",
    name: "QwQ 32B",
    description: "Very strong reasoning, large model",
    params: "32B", vram_gb: 64, vram_int8_gb: 32, context_k: 128,
    tags: ["reasoning", "large"],
    no_auth: true,
  },
  {
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B",
    description: "OpenAI's open-weight reasoning model — MXFP4, ~16GB VRAM",
    params: "20B", vram_gb: 16, vram_int8_gb: 16, context_k: 128,
    tags: ["reasoning", "openai", "ollama"],
    no_auth: true,
  },
  {
    id: "gpt-oss:120b",
    name: "GPT-OSS 120B",
    description: "OpenAI's largest open-weight model — requires ~80GB VRAM",
    params: "120B", vram_gb: 80, vram_int8_gb: 80, context_k: 128,
    tags: ["reasoning", "openai", "ollama"],
    no_auth: true,
  },
];

const setup = new Hono<HonoVars>();

setup.get("/status", async c => {
  const status = getInferenceStatus();

  if (status.status === "running") {
    const healthy = await checkInferenceHealth(status.model);
    if (!healthy) {
      return c.json({
        ...status,
        status: "error",
        error: "Ollama unreachable or model not loaded",
      });
    }
  }

  const tunnelUrl = db.prepare("SELECT value FROM settings WHERE key = 'tunnel_url'").get() as { value: string } | undefined;
  return c.json({ ...status, tunnel_url: tunnelUrl?.value ?? null });
});

setup.get("/models", c => c.json({ models: MODELS }));

setup.get("/diagnostics", async c => {
  const diagnostics = await probeOllama({ log: false });
  return c.json(diagnostics);
});

setup.post("/deploy", adminAuth, async c => {
  const body: { model?: string; replace?: boolean } = await c.req.json<{ model?: string; replace?: boolean }>().catch(() => ({}));
  const modelId = body.model?.trim();
  if (!modelId) return c.json({ error: "model is required" }, 400);

  if (!isOllamaSupported(modelId)) {
    return c.json({
      error: "Invalid model. Pick from the list or enter a valid Ollama model name (e.g. gpt-oss:20b, qwen3.5:9b). Browse models at https://ollama.com/search",
    }, 400);
  }

  if (isDeploymentInProgress()) {
    if (!body.replace) {
      return c.json({ error: "A deployment is already in progress", in_progress: true }, 409);
    }
    await cancelDeployment();
  }

  const preflight = await probeOllama({ log: false });
  if (!preflight.reachable) {
    return c.json({
      error: `Cannot reach Ollama at ${preflight.url}: ${preflight.error ?? "connection failed"}`,
      hint: preflight.hint ?? "Check the Ollama container: docker compose logs ollama",
      ollama_url: preflight.url,
      diagnostics: preflight,
    }, 503);
  }

  deployModel(modelId).catch(err => {
    console.error("Deploy error:", err);
  });

  return c.json({ ok: true, message: "Deployment started", model: modelId });
});

setup.post("/cancel", adminAuth, async c => {
  await cancelDeployment();
  return c.json({ ok: true });
});

setup.post("/stop", adminAuth, async c => {
  await stopInference();
  return c.json({ ok: true });
});

setup.get("/logs", adminAuth, c => {
  return streamSSE(c, async stream => {
    for await (const line of inferenceLogs()) {
      await stream.writeSSE({ data: JSON.stringify({ line }) });
    }
  });
});

setup.post("/tunnel", adminAuth, async c => {
  const body: { url?: string } = await c.req.json<{ url?: string }>().catch(() => ({}));
  if (!body.url) return c.json({ error: "url required" }, 400);
  db.prepare("INSERT INTO settings (key, value) VALUES ('tunnel_url', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(body.url);
  return c.json({ ok: true });
});

export { setup };
