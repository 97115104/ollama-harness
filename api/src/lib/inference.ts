/** Ollama inference URL — host Ollama when running API in Docker. */
export function getInferenceUrl(): string {
  return process.env.OLLAMA_URL || "http://host.docker.internal:11434";
}

export function getInferenceBackend(): "ollama" {
  return "ollama";
}

export async function checkInferenceHealth(modelTag?: string | null): Promise<boolean> {
  const { checkOllamaHealth } = await import("./ollama.js");
  return checkOllamaHealth(modelTag);
}
