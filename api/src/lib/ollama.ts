import db from "../db/index.js";
import { getInferenceUrl } from "./inference.js";

export interface OllamaModelDef {
  tag: string;
  context: number;
}

/** Ollama model tag → metadata (context window for token clamping). */
export const OLLAMA_MODELS: Record<string, OllamaModelDef> = {
  "tinyllama":         { tag: "tinyllama",         context: 2048 },
  "smollm2:1.7b":      { tag: "smollm2:1.7b",      context: 2048 },
  "phi3.5":            { tag: "phi3.5",            context: 4096 },
  "phi4-mini":         { tag: "phi4-mini",         context: 4096 },
  "llama3.2:3b":       { tag: "llama3.2:3b",       context: 8192 },
  "mistral":           { tag: "mistral",           context: 8192 },
  "qwen2.5:7b":        { tag: "qwen2.5:7b",        context: 8192 },
  "qwen2.5:14b":       { tag: "qwen2.5:14b",       context: 8192 },
  "deepseek-r1:7b":    { tag: "deepseek-r1:7b",    context: 8192 },
  "llama3.1:8b":       { tag: "llama3.1:8b",       context: 8192 },
  "qwq":               { tag: "qwq",               context: 8192 },
};

/** HuggingFace model id (UI/API) → Ollama pull tag. */
export const HF_TO_OLLAMA: Record<string, string> = {
  "mistralai/Mistral-7B-Instruct-v0.3":           "mistral",
  "Qwen/Qwen2.5-7B-Instruct":                     "qwen2.5:7b",
  "microsoft/Phi-4-mini-instruct":                "phi4-mini",
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0":           "tinyllama",
  "Qwen/Qwen2.5-14B-Instruct":                    "qwen2.5:14b",
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B":      "deepseek-r1:7b",
  "microsoft/Phi-3.5-mini-instruct":              "phi3.5",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct":          "smollm2:1.7b",
  "meta-llama/Llama-3.1-8B-Instruct":             "llama3.1:8b",
  "meta-llama/Llama-3.2-3B-Instruct":             "llama3.2:3b",
  "Qwen/QwQ-32B":                                 "qwq",
};

class DeployCancelledError extends Error {
  constructor() { super("Deployment cancelled"); this.name = "DeployCancelledError"; }
}

let deployGeneration = 0;
let cancelledGeneration = 0;
let activePullAbort: AbortController | null = null;

function setSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function isDeployCancelled(generation: number): boolean {
  return generation <= cancelledGeneration;
}

export function isOllamaSupported(modelId: string): boolean {
  return modelId in HF_TO_OLLAMA;
}

export function resolveOllamaTag(modelId: string): string {
  if (modelId === "default") {
    const deployed = getInferenceStatus().model;
    if (deployed) modelId = deployed;
  }
  return HF_TO_OLLAMA[modelId] ?? OLLAMA_MODELS[modelId]?.tag ?? modelId;
}

export function ollamaContextLen(modelId: string): number {
  const tag = resolveOllamaTag(modelId);
  const def = OLLAMA_MODELS[tag];
  return def?.context ?? 4096;
}

export function isKnownModel(modelId: string): boolean {
  return isOllamaSupported(modelId);
}

export function isDeploymentInProgress(): boolean {
  const status = getSetting("ollama_status") || "idle";
  return status === "pulling" || status === "starting";
}

export function getInferenceStatus() {
  return {
    status:   getSetting("ollama_status") || "idle",
    model:    getSetting("ollama_model"),
    error:    getSetting("ollama_error"),
    progress: getSetting("ollama_progress"),
    gpu_util: null as string | null,
    max_model_len: getSetting("ollama_max_model_len"),
    gpu_type: process.env.GPU_TYPE || "cpu",
    engine: "ollama" as const,
  };
}

export async function checkOllamaHealth(modelTag?: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${getInferenceUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    if (!modelTag) return true;
    const tag = resolveOllamaTag(modelTag);
    const data = await res.json() as { models?: { name: string }[] };
    return data.models?.some(m => m.name === tag || m.name.startsWith(`${tag}:`)) ?? false;
  } catch {
    return false;
  }
}

async function warmOllamaModel(tag: string): Promise<void> {
  await fetch(`${getInferenceUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: tag,
      prompt: "hi",
      stream: false,
      options: { num_predict: 1 },
      keep_alive: "30m",
    }),
  }).catch(() => { /* warm-up is best-effort */ });
}

export async function cancelDeployment(): Promise<void> {
  cancelledGeneration = deployGeneration;
  activePullAbort?.abort();
  activePullAbort = null;
  setSetting("ollama_status", "idle");
  setSetting("ollama_model", "");
  setSetting("ollama_error", "");
  setSetting("ollama_progress", "");
  setSetting("ollama_max_model_len", "");
}

export async function stopInference(): Promise<void> {
  const model = db.prepare("SELECT value FROM settings WHERE key='ollama_model'").get() as { value: string } | undefined;
  if (model?.value) {
    const tag = resolveOllamaTag(model.value);
    await fetch(`${getInferenceUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ model: tag, keep_alive: 0 }),
    }).catch(() => { /* ok */ });
  }
  setSetting("ollama_status", "idle");
  setSetting("ollama_model", "");
  setSetting("ollama_error", "");
  setSetting("ollama_progress", "");
  setSetting("ollama_max_model_len", "");
}

async function pullOllamaModel(modelId: string, myGen: number): Promise<void> {
  if (!isOllamaSupported(modelId)) throw new Error(`Unknown model: ${modelId}`);

  const tag = resolveOllamaTag(modelId);
  const context = ollamaContextLen(modelId);

  setSetting("ollama_status", "pulling");
  setSetting("ollama_model", modelId);
  setSetting("ollama_error", "");
  setSetting("ollama_progress", `Pulling ${tag} via Ollama…`);
  setSetting("ollama_max_model_len", String(context));

  activePullAbort = new AbortController();
  const pullRes = await fetch(`${getInferenceUrl()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: activePullAbort.signal,
    body: JSON.stringify({ name: tag, stream: true }),
  });
  if (!pullRes.ok) {
    throw new Error(`Ollama pull failed (HTTP ${pullRes.status}). Is '${tag}' a valid model tag?`);
  }

  const reader = pullRes.body?.getReader();
  if (reader) {
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      if (isDeployCancelled(myGen)) throw new DeployCancelledError();
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { status?: string };
          if (ev.status) setSetting("ollama_progress", ev.status);
        } catch { /* skip partial line */ }
      }
      buf = buf.split("\n").pop() ?? "";
    }
  }
  activePullAbort = null;

  if (isDeployCancelled(myGen)) throw new DeployCancelledError();

  setSetting("ollama_status", "starting");
  setSetting("ollama_progress", "Loading model into memory…");
  await warmOllamaModel(tag);

  if (isDeployCancelled(myGen)) throw new DeployCancelledError();

  setSetting("ollama_status", "running");
  setSetting("ollama_error", "");
  setSetting("ollama_progress", "");
}

export async function deployModel(modelId: string): Promise<void> {
  const myGen = ++deployGeneration;
  try {
    await pullOllamaModel(modelId, myGen);
  } catch (e) {
    if (e instanceof DeployCancelledError || isDeployCancelled(myGen)) return;
    setSetting("ollama_status", "error");
    setSetting("ollama_error", e instanceof Error ? e.message : String(e));
    setSetting("ollama_progress", "");
    throw e;
  }
}

export async function* inferenceLogs(): AsyncGenerator<string> {
  while (true) {
    const status = db.prepare("SELECT value FROM settings WHERE key='ollama_status'").get() as { value: string } | undefined;
    const st = status?.value ?? "idle";
    if (st === "idle" || st === "error" || st === "running") return;
    const progress = db.prepare("SELECT value FROM settings WHERE key='ollama_progress'").get() as { value: string } | undefined;
    yield `[ollama] ${progress?.value || "…"}\n`;
    await new Promise(r => setTimeout(r, 1500));
  }
}
