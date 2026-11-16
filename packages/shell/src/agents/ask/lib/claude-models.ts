/** The models an Anthropic key may use, from the provider's own list (`GET /v1/models`), newest first as it lists them; null when the key does not answer. */

import { isRecord } from "@dashi/shape";
import { ANTHROPIC_HOST, ANTHROPIC_VERSION } from "./claude.ts";
import type { Fetch } from "./http.ts";

const TIMEOUT_MS = 8_000;

export async function listClaudeModels(key: string, send: Fetch = (url, init) => fetch(url, init)): Promise<string[] | null> {
  try {
    const response = await send(`https://${ANTHROPIC_HOST}/v1/models?limit=50`, {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    return data.flatMap((model) => (isRecord(model) && typeof model.id === "string" ? [model.id] : []));
  } catch {
    return null;
  }
}
