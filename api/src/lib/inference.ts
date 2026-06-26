/** Ollama inference URL — the ollama service in Docker Compose by default. */
export function getInferenceUrl(): string {
  return process.env.OLLAMA_URL || "http://ollama:11434";
}

export function getInferenceBackend(): "ollama" {
  return "ollama";
}

export async function checkInferenceHealth(modelTag?: string | null): Promise<boolean> {
  const { checkOllamaHealth } = await import("./ollama.js");
  return checkOllamaHealth(modelTag);
}
