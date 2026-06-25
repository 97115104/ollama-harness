import { Hono } from "hono";
import { createHash } from "crypto";
import db from "../db/index.js";
import type { ApiKey } from "../db/index.js";
import type { HonoVars } from "../middleware/auth.js";
import { getInferenceStatus } from "../lib/ollama.js";
import { getInferenceUrl } from "../lib/inference.js";
import { resolveOllamaTag } from "../lib/ollama.js";

/** Clamp max_tokens so prompt + completion fits within the deployed model context. */
function clampMaxTokens(body: Record<string, unknown>): void {
  const stored = Number(getInferenceStatus().max_model_len);
  const maxModelLen = stored || 4096;
  const requested = Number(body.max_tokens ?? 512);
  const cap = Math.max(64, maxModelLen - 256);
  body.max_tokens = Math.min(requested, cap);
}

/** Map OpenAI client fields to what Ollama expects. */
function normalizeOpenAiBody(body: Record<string, unknown>): void {
  if (body.max_completion_tokens != null && body.max_tokens == null) {
    body.max_tokens = body.max_completion_tokens;
  }
  delete body.max_completion_tokens;
}

const chat = new Hono<HonoVars>();

const openaiError = (message: string, type = "server_error", code: string | null = null, status = 500) =>
  Response.json({ error: { message, type, param: null, code } }, { status });

chat.use("/*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const raw    = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return openaiError("No API key provided.", "invalid_request_error", "missing_api_key", 401);

  const hash = createHash("sha256").update(raw).digest("hex");
  const key  = db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(hash) as ApiKey | undefined;
  if (!key || !key.active)
    return openaiError("Invalid API key. Generate one at /admin → Keys.", "invalid_request_error", "invalid_api_key", 401);

  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(key.id);
  c.set("apiKey", key);
  await next();
});

chat.get("/models", c => {
  const status = getInferenceStatus();
  if (!status.model || status.status !== "running") {
    return c.json({ object: "list", data: [] });
  }
  const now = Math.floor(Date.now() / 1000);
  return c.json({
    object: "list",
    data: [
      { id: "default", object: "model", created: now, owned_by: "ollama" },
      { id: status.model, object: "model", created: now, owned_by: "ollama" },
    ],
  });
});

// Transparent proxy — forwards all /v1/* to Ollama's OpenAI-compatible API
chat.all("/*", async c => {
  const apiPath = c.req.path.replace(/^\/v1/, "");
  const method   = c.req.method;
  const key      = c.get("apiKey") as ApiKey;
  const t0       = Date.now();

  let parsedBody: Record<string, unknown> | undefined;
  let rawBody: ArrayBuffer | undefined;

  if (method !== "GET" && method !== "HEAD") {
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    if (ct.includes("application/json")) {
      parsedBody = await c.req.json<Record<string, unknown>>().catch(() => undefined);
    }
    if (!parsedBody) rawBody = await c.req.arrayBuffer();
  }

  const isChatCompletion   = apiPath === "/chat/completions" && method === "POST";
  const isLegacyCompletion = apiPath === "/completions"       && method === "POST";

  let requestId: string | undefined;
  let promptFull: string | undefined;

  if ((isChatCompletion || isLegacyCompletion) && parsedBody) {
    if (isChatCompletion) {
      const requested = String(parsedBody.model ?? "");
      if (requested === "default" && !getInferenceStatus().model) {
        return openaiError(
          "No model is deployed. Open the dashboard, deploy a model, and wait until it is running.",
          "invalid_request_error",
          "model_not_found",
          503,
        );
      }
      normalizeOpenAiBody(parsedBody);
      clampMaxTokens(parsedBody);
      parsedBody.model = resolveOllamaTag(requested);
      parsedBody.keep_alive = "30m";
    }

    const model = String(parsedBody.model ?? "unknown");
    let promptPreview = "";

    if (isChatCompletion) {
      const msgs = (parsedBody.messages as { role?: string; content?: unknown }[] | undefined) ?? [];
      const lastUser = [...msgs].reverse().find(m => m.role === "user" || m.role === "assistant");
      promptFull    = msgs.map(m => `[${m.role}] ${String(m.content ?? "")}`).join("\n\n");
      promptPreview = String(lastUser?.content ?? "").slice(0, 200);
    } else {
      promptFull    = String(parsedBody.prompt ?? "");
      promptPreview = promptFull.slice(0, 200);
    }

    const row = db.prepare(
      "INSERT INTO requests (api_key_id, model, status, prompt_preview, prompt_full) VALUES (?,?,'pending',?,?) RETURNING id"
    ).get(key.id, model, promptPreview, promptFull ?? null) as { id: string } | undefined;
    requestId = row?.id;
  }

  try {
    const bodyPayload = parsedBody !== undefined
      ? JSON.stringify(parsedBody)
      : (rawBody as BodyInit | undefined);

    const upstream = await fetch(`${getInferenceUrl()}/v1${apiPath}`, {
      method,
      headers: { "content-type": "application/json", "accept": "*/*" },
      body: bodyPayload,
    });

    const isStream  = parsedBody?.stream === true;
    const latencyMs = Date.now() - t0;

    if (requestId) {
      if (!upstream.ok) {
        db.prepare("UPDATE requests SET status='failed', latency_ms=?, error=? WHERE id=?")
          .run(latencyMs, `HTTP ${upstream.status}`, requestId);
      } else if (isStream) {
        const [clientStream, logStream] = upstream.body!.tee();

        const rid = requestId;
        (async () => {
          const reader = logStream.getReader();
          const dec    = new TextDecoder();
          let content  = "";
          let tOut     = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const text = dec.decode(value, { stream: true });
              for (const line of text.split("\n")) {
                if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
                try {
                  const chunk = JSON.parse(line.slice(6)) as { choices?: { delta?: { content?: string }; finish_reason?: string }[]; usage?: { completion_tokens?: number } };
                  content += chunk.choices?.[0]?.delta?.content ?? "";
                  if (chunk.usage?.completion_tokens) tOut = chunk.usage.completion_tokens;
                } catch { /* skip */ }
              }
            }
          } catch { /* stream ended */ }
          db.prepare("UPDATE requests SET status='completed', latency_ms=?, response_content=?, tokens_out=? WHERE id=?")
            .run(Date.now() - t0, content || null, tOut || null, rid);
        })();

        const responseHeaders: Record<string, string> = {};
        upstream.headers.forEach((v, k) => {
          if (!["transfer-encoding", "connection", "keep-alive"].includes(k.toLowerCase()))
            responseHeaders[k] = v;
        });
        return new Response(clientStream, { status: upstream.status, headers: responseHeaders });

      } else {
        const cloned = upstream.clone();
        (cloned.json() as Promise<{ choices?: { message?: { content?: string }; text?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }>)
          .then(body => {
            const responseContent = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? null;
            db.prepare("UPDATE requests SET status='completed', latency_ms=?, tokens_in=?, tokens_out=?, response_content=? WHERE id=?")
              .run(latencyMs, body.usage?.prompt_tokens ?? null, body.usage?.completion_tokens ?? null, responseContent, requestId);
          })
          .catch(() => {
            db.prepare("UPDATE requests SET status='completed', latency_ms=? WHERE id=?").run(latencyMs, requestId);
          });
      }
    }

    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      if (!["transfer-encoding", "connection", "keep-alive"].includes(k.toLowerCase()))
        responseHeaders[k] = v;
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });

  } catch (e) {
    if (requestId) {
      db.prepare("UPDATE requests SET status='failed', error=? WHERE id=?")
        .run(e instanceof Error ? e.message : String(e), requestId);
    }
    return openaiError("The inference engine is unavailable. Is a model deployed?", "server_error", "engine_unavailable", 503);
  }
});

export { chat };
