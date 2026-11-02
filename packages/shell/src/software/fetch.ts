/**
 * The one way Software reaches the network: HTTPS to an allowed host only,
 * redirects followed by hand (each hop must be HTTPS on an allowed host, at
 * most three), a time limit, and a cap on the size of the body that is
 * enforced while it streams in, not after.
 */

import { httpsUrl } from "./parse-values.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class NetworkError extends Error {
  constructor(
    readonly kind: "offline" | "refused" | "too-large" | "http",
    message: string,
  ) {
    super(message);
  }
}

export interface GetOptions {
  hosts: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  init?: RequestInit;
  fetch?: FetchLike;
}

const MAX_REDIRECTS = 3;

/** The response body, at most `maxBytes`, from an allowed HTTPS URL. */
export async function getBytes(url: string, options: GetOptions): Promise<Uint8Array> {
  const fetcher = options.fetch ?? ((target, init) => fetch(target, init));
  let target = httpsUrl(url, options.hosts);
  if (target === null) throw new NetworkError("refused", "not an HTTPS address on an allowed host");
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetcher(target, {
        ...options.init,
        redirect: "manual",
        signal,
        headers: { accept: "*/*", ...(options.init?.headers as Record<string, string> | undefined) },
      });
    } catch (error) {
      throw new NetworkError("offline", error instanceof Error ? error.message : "no connection");
    }
    if (response.status >= 300 && response.status < 400) {
      const next = httpsUrl(new URL(response.headers.get("location") ?? "", target).href, options.hosts);
      if (next === null) throw new NetworkError("refused", "redirected somewhere that is not allowed");
      target = next;
      continue;
    }
    if (!response.ok) throw new NetworkError("http", `the server answered ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > options.maxBytes) throw new NetworkError("too-large", "the answer is too large");
    return readCapped(response, options.maxBytes);
  }
  throw new NetworkError("refused", "too many redirects");
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer()).subarray(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new NetworkError("too-large", "the answer is too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof NetworkError) throw error;
    throw new NetworkError("offline", error instanceof Error ? error.message : "the connection dropped");
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body;
}
