/**
 * The one way the API answerers (claude.ts, gpt.ts) talk to a provider: a
 * JSON request over `fetch`, with a timeout for each try, a try again after
 * what is worth trying again, and the provider's error read once. No
 * provider library: both providers' endpoints are plain JSON over HTTPS.
 *
 * A request never reads the session: the URL, the headers and the body are
 * the caller's, and the key is in the headers it sends and nowhere else.
 * Nothing here logs, and no error carries a header or the request.
 */

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The provider answered with an error status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** The error body, parsed when it was JSON; the text when it wasn't. */
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }

  /** The error's `code` (OpenAI's `insufficient_quota`, say), if it names one. */
  get code(): string | null {
    const code = errorOf(this.body)?.code;
    return typeof code === "string" ? code : null;
  }
}

/** Nothing answered: the connection failed or a try ran out of time. */
export class NoReachError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? "Timed out." : "Couldn't connect.");
  }
}

/** The answer came, but isn't JSON. */
export class UnreadableError extends Error {
  constructor() {
    super("The answer isn't JSON.");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `{ error: { … } }`, as both providers send it. */
const errorOf = (body: unknown): Record<string, unknown> | null => {
  const outer = isRecord(body) ? body.error : undefined;
  return isRecord(outer) ? outer : null;
};

/** The provider's error words, short and on one line; empty when it said none. */
export function errorWords(body: unknown): string {
  const message = errorOf(body)?.message;
  return typeof message === "string" ? message.replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

export interface JsonRequest {
  url: string;
  /** Includes the key; it goes nowhere else. */
  headers: Readonly<Record<string, string>>;
  /** Sent as JSON; a GET has none. */
  body?: unknown;
  signal?: AbortSignal;
  /** For each try. */
  timeoutMs: number;
  /** How many more tries after the first. */
  retries: number;
  fetch?: Fetch;
  /** For tests: waits `ms`, ending early (by rejecting) when `signal` aborts. */
  wait?(ms: number, signal: AbortSignal | undefined): Promise<void>;
}

const BACKOFF_FIRST_MS = 500;
const BACKOFF_MAX_MS = 8000;
/** The longest wait a provider's Retry-After is obeyed for; a launcher doesn't sit for a minute. */
const RETRY_AFTER_MAX_MS = 30_000;

const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });

/** Whether an error status is worth another try: the provider's `x-should-retry` first, else a timeout, a conflict, a rate limit or a server error. */
function worthRetrying(response: Response): boolean {
  const said = response.headers.get("x-should-retry");
  if (said === "true") return true;
  if (said === "false") return false;
  const { status } = response;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** How long to wait before try number `tried` (1 for the first retry): what the provider asks for, else backing off. */
function retryDelay(response: Response | null, tried: number): number {
  const ms = Number.parseFloat(response?.headers.get("retry-after-ms") ?? "");
  const seconds = Number.parseFloat(response?.headers.get("retry-after") ?? "");
  const date = Date.parse(response?.headers.get("retry-after") ?? "") - Date.now();
  const asked = [ms, seconds * 1000, date].find((each) => each > 0 && each <= RETRY_AFTER_MAX_MS);
  if (asked !== undefined) return asked;
  return Math.min(BACKOFF_FIRST_MS * 2 ** (tried - 1), BACKOFF_MAX_MS) * (1 - Math.random() * 0.25);
}

/**
 * One JSON request, parsed. Rejects with `HttpError` (an error status, after
 * the tries), `NoReachError` (no connection, or out of time, after the
 * tries) or `UnreadableError`; with the caller's own abort reason when
 * `signal` aborts.
 */
export async function requestJson(request: JsonRequest): Promise<unknown> {
  const send = request.fetch ?? fetch;
  const wait = request.wait ?? sleep;
  const hasBody = request.body !== undefined;
  for (let tried = 0; ; tried++) {
    const last = tried >= request.retries;
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await send(request.url, {
        method: hasBody ? "POST" : "GET",
        headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}), ...request.headers },
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (last) throw new NoReachError(timeout.aborted);
      await wait(retryDelay(null, tried + 1), request.signal);
      continue;
    }
    if (!response.ok) {
      if (!last && worthRetrying(response)) {
        await response.body?.cancel().catch(() => {});
        await wait(retryDelay(response, tried + 1), request.signal);
        continue;
      }
      const text = await response.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: the text stands.
      }
      throw new HttpError(response.status, body);
    }
    try {
      return await response.json();
    } catch (error) {
      // The caller's abort, or the try's own timeout, can land while the body is read.
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new NoReachError(true);
      throw new UnreadableError();
    }
  }
}
