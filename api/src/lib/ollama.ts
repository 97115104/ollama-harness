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
  "gpt-oss:20b":       { tag: "gpt-oss:20b",       context: 131072 },
  "gpt-oss:120b":      { tag: "gpt-oss:120b",      context: 131072 },
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

const DEPLOY_LOG_MAX = 200;
const deployLogs: string[] = [];

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function appendDeployLog(message: string): void {
  const line = `[${ts()}] ${message}`;
  deployLogs.push(line);
  if (deployLogs.length > DEPLOY_LOG_MAX) deployLogs.splice(0, deployLogs.length - DEPLOY_LOG_MAX);
  console.log(`[deploy] ${message}`);
}

export function getRecentDeployLogs(limit = 50): string[] {
  return deployLogs.slice(-limit);
}

export function clearDeployLogs(): void {
  deployLogs.length = 0;
}

export interface OllamaDiagnostics {
  url: string;
  reachable: boolean;
  latency_ms: number | null;
  version: string | null;
  model_count: number | null;
  error: string | null;
  hint: string | null;
}

function formatFetchError(op: string, url: string, err: unknown): string {
  const base = `Ollama ${op} failed — cannot reach ${url}`;
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause
    ? (err.cause instanceof Error ? err.cause.message : String(err.cause))
    : null;
  const detail = cause && cause !== msg ? `${msg} (${cause})` : msg;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket/i.test(detail)) {
    return `${base}: ${detail}. Check the Ollama container: docker compose logs ollama`;
  }
  return `${base}: ${detail}`;
}

export async function probeOllama(opts?: { log?: boolean }): Promise<OllamaDiagnostics> {
  const log = opts?.log ?? false;
  const url = getInferenceUrl();
  const t0 = Date.now();
  if (log) appendDeployLog(`Probing ${url}/api/tags…`);
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      const err = `HTTP ${res.status} ${res.statusText}`;
      if (log) appendDeployLog(`Probe failed: ${err}`);
      return {
        url, reachable: false, latency_ms, version: null, model_count: null,
        error: err, hint: "Ollama responded with an error. Check Ollama logs.",
      };
    }
    const data = await res.json() as { models?: { name: string }[] };
    let version: string | null = null;
    try {
      const vRes = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(3000) });
      if (vRes.ok) {
        const v = await vRes.json() as { version?: string };
        version = v.version ?? null;
      }
    } catch { /* optional */ }
    if (log) appendDeployLog(`Ollama OK (${latency_ms}ms${version ? `, v${version}` : ""}, ${data.models?.length ?? 0} models cached)`);
    return {
      url, reachable: true, latency_ms, version,
      model_count: data.models?.length ?? 0, error: null, hint: null,
    };
  } catch (err) {
    const latency_ms = Date.now() - t0;
    const error = err instanceof Error ? err.message : String(err);
    if (log) appendDeployLog(`Probe failed: ${error}`);
    return {
      url, reachable: false, latency_ms, version: null, model_count: null,
      error,
      hint: "Check the Ollama container: docker compose logs ollama",
    };
  }
}

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

/** Clear interrupted or stale deploy state left in SQLite from a prior run. */
export function resetStaleDeployState(): void {
  const status = getSetting("ollama_status") || "idle";
  if (status === "pulling" || status === "starting" || status === "error") {
    clearDeployLogs();
    appendDeployLog(`Cleared stale deploy state (was: ${status})`);
    setSetting("ollama_status", "idle");
    setSetting("ollama_error", "");
    setSetting("ollama_progress", "");
    // Keep ollama_model so the UI can offer one-click retry after a failed deploy.
  }
}

function isDeployCancelled(generation: number): boolean {
  return generation <= cancelledGeneration;
}

/** Ollama library tag, e.g. `gpt-oss:20b`, `qwen3.5:9b`. */
const OLLAMA_TAG_RE = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)*$/i;

export function isValidOllamaTag(tag: string): boolean {
  return OLLAMA_TAG_RE.test(tag);
}

export function isOllamaSupported(modelId: string): boolean {
  return modelId in HF_TO_OLLAMA || modelId in OLLAMA_MODELS || isValidOllamaTag(modelId);
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
    ollama_url: getInferenceUrl(),
    deploy_logs: getRecentDeployLogs(30),
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

export async function cancelDeployment(): Promise<void> {
  cancelledGeneration = deployGeneration;
  activePullAbort?.abort();
  activePullAbort = null;
  appendDeployLog("Deployment cancelled");
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
  const ollamaUrl = getInferenceUrl();

  clearDeployLogs();
  appendDeployLog(`Deploy started: ${modelId} → Ollama tag "${tag}"`);
  appendDeployLog(`Ollama URL: ${ollamaUrl} (set OLLAMA_URL to override)`);

  setSetting("ollama_status", "pulling");
  setSetting("ollama_model", modelId);
  setSetting("ollama_error", "");
  setSetting("ollama_progress", "Checking Ollama connection…");
  setSetting("ollama_max_model_len", String(context));

  const probe = await probeOllama({ log: true });
  if (!probe.reachable) {
    throw new Error(
      `Cannot reach Ollama at ${probe.url}: ${probe.error ?? "connection failed"}. ${probe.hint ?? ""}`,
    );
  }

  if (isDeployCancelled(myGen)) throw new DeployCancelledError();

  setSetting("ollama_progress", `Pulling ${tag} via Ollama…`);
  appendDeployLog(`POST ${ollamaUrl}/api/pull name=${tag}`);

  activePullAbort = new AbortController();
  let pullRes: Response;
  try {
    pullRes = await fetch(`${ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: activePullAbort.signal,
      body: JSON.stringify({ name: tag, stream: true }),
    });
  } catch (err) {
    throw new Error(formatFetchError("pull", `${ollamaUrl}/api/pull`, err));
  }
  if (!pullRes.ok) {
    let body = "";
    try { body = await pullRes.text(); } catch { /* ignore */ }
    appendDeployLog(`Pull HTTP ${pullRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`Ollama pull failed (HTTP ${pullRes.status}). Is '${tag}' a valid model tag?${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }

  const reader = pullRes.body?.getReader();
  if (reader) {
    const dec = new TextDecoder();
    let buf = "";
    let lastProgress = "";
    while (true) {
      if (isDeployCancelled(myGen)) throw new DeployCancelledError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw new Error(formatFetchError("pull stream", `${ollamaUrl}/api/pull`, err));
      }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as {
            status?: string; error?: string;
            completed?: number; total?: number;
          };
          if (ev.error) appendDeployLog(`Pull error: ${ev.error}`);
          if (ev.status) {
            let progress = ev.status;
            if (ev.total != null && ev.total > 0 && ev.completed != null) {
              const pct = Math.round((ev.completed / ev.total) * 100);
              progress = `${ev.status} (${pct}%)`;
            }
            if (progress !== lastProgress) {
              lastProgress = progress;
              setSetting("ollama_progress", progress);
              appendDeployLog(progress);
            }
          }
        } catch { /* skip partial line */ }
      }
      buf = buf.split("\n").pop() ?? "";
    }
  }
  activePullAbort = null;

  if (isDeployCancelled(myGen)) throw new DeployCancelledError();

  setSetting("ollama_status", "starting");
  setSetting("ollama_progress", "Loading model into memory…");
  appendDeployLog(`Warming model ${tag}…`);
  try {
    const warmRes = await fetch(`${ollamaUrl}/api/generate`, {
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
    });
    if (!warmRes.ok) {
      const body = await warmRes.text().catch(() => "");
      appendDeployLog(`Warm-up HTTP ${warmRes.status}: ${body.slice(0, 200)}`);
      throw new Error(`Model load failed (HTTP ${warmRes.status})${body ? `: ${body.slice(0, 150)}` : ""}`);
    }
    appendDeployLog("Model loaded into memory");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Model load failed")) throw err;
    throw new Error(formatFetchError("load", `${ollamaUrl}/api/generate`, err));
  }

  if (isDeployCancelled(myGen)) throw new DeployCancelledError();

  setSetting("ollama_status", "running");
  setSetting("ollama_error", "");
  setSetting("ollama_progress", "");
  appendDeployLog(`Deploy complete: ${tag} is running`);
}

export async function deployModel(modelId: string): Promise<void> {
  const myGen = ++deployGeneration;
  try {
    await pullOllamaModel(modelId, myGen);
  } catch (e) {
    if (e instanceof DeployCancelledError || isDeployCancelled(myGen)) return;
    const msg = e instanceof Error ? e.message : String(e);
    appendDeployLog(`Deploy failed: ${msg}`);
    setSetting("ollama_status", "error");
    setSetting("ollama_error", msg);
    setSetting("ollama_progress", "");
    console.error("Deploy error:", e);
    throw e;
  }
}

export async function* inferenceLogs(): AsyncGenerator<string> {
  let lastIdx = 0;
  while (true) {
    while (lastIdx < deployLogs.length) {
      yield deployLogs[lastIdx++] + "\n";
    }
    const status = db.prepare("SELECT value FROM settings WHERE key='ollama_status'").get() as { value: string } | undefined;
    const st = status?.value ?? "idle";
    if (st === "idle" || st === "error" || st === "running") {
      while (lastIdx < deployLogs.length) yield deployLogs[lastIdx++] + "\n";
      return;
    }
    const progress = db.prepare("SELECT value FROM settings WHERE key='ollama_progress'").get() as { value: string } | undefined;
    if (progress?.value) yield `[ollama] ${progress.value}\n`;
    await new Promise(r => setTimeout(r, 1500));
  }
}
