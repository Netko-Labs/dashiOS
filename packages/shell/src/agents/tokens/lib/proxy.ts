/**
 * One agent sandbox's token proxy (docs/secrets.md, "Tokens that stay
 * home"). It answers CONNECT on a socket only that sandbox reaches, with the
 * sandbox's own credentials:
 *
 * - to port 443 of a host a token item lists, it terminates TLS itself with
 *   a leaf certificate from the sandbox's CA (made for that host alone),
 *   puts each token in whichever of the item's headers carries its placeholder, and
 *   forwards the request over TLS it verifies;
 * - anywhere else, it tunnels the bytes untouched: a placeholder sent there
 *   is worthless.
 *
 * The vault is asked for a token only when its placeholder is in a request,
 * and hands it out only for a listed host. Tokens are never logged; the
 * activity log notes which token went to which host, once per sandbox.
 */

import { existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { TokenSummary } from "../../secrets/vault.ts";
import { authorized, type Candidate, forwardHeaders, hostListed, isHostName, MAX_HEAD, parseConnect, swapHeaders, wanted } from "../swap.ts";
import { type Authority, type Issued, issueLeaf } from "./x509.ts";

/** What the proxy asks of the vault. */
export interface TokenSource {
  list(): Promise<TokenSummary[]>;
  forHost(name: string, host: string): Promise<{ token: Uint8Array; headers: string[] }>;
}

export interface ProxyOptions {
  /** The sandbox's scope, for the activity log. */
  unit: string;
  /** A directory of the shell's for this sandbox (0700): the TLS servers' sockets go here. */
  dir: string;
  /** The sandbox's proxy credentials (HTTPS_PROXY's password). */
  key: string;
  ca: Authority;
  tokens: TokenSource;
  /** Where a listed host's requests go: `https://<host>` (tests point it elsewhere). */
  upstream?: (host: string) => string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** A token went to a host, for the first time in this sandbox. */
  used?: (name: string, host: string) => void;
}

/** How long the token items' list is kept between CONNECTs. */
const LIST_MS = 5_000;
/** A CONNECT's head must arrive within this. */
const HEAD_MS = 10_000;
const MAX_CONNECTIONS = 256;
/** A leaf is made again when it has less than this left. */
const RENEW_MS = 24 * 3_600_000;

interface Terminator {
  path: string;
  server: ReturnType<typeof Bun.serve>;
  notAfter: Date;
}

const ESTABLISHED = "HTTP/1.1 200 Connection Established\r\n\r\n";

function refusal(status: number, reason: string, extra = ""): string {
  return `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain\r\nConnection: close\r\n${extra}Content-Length: ${reason.length + 1}\r\n\r\n${reason}\n`;
}

/** The response's headers without the connection's own. */
function backHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of ["connection", "keep-alive", "transfer-encoding", "proxy-connection"]) out.delete(name);
  return out;
}

export class SandboxProxy {
  private readonly server: net.Server;
  private readonly terminators = new Map<string, Promise<Terminator>>();
  private listed: { at: number; items: Promise<TokenSummary[]> } | null = null;
  private readonly noted = new Set<string>();
  private connections = 0;
  private serial = 0;
  private closed = false;

  constructor(private readonly options: ProxyOptions) {
    this.server = net.createServer((client) => this.accept(client));
  }

  /** Listen on `path` (a socket file, 0600). */
  listen(path: string): Promise<void> {
    if (existsSync(path)) unlinkSync(path);
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(path, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.server.close();
    for (const pending of this.terminators.values()) void pending.then((t) => this.stop(t)).catch(() => {});
    this.terminators.clear();
  }

  /** The token items for `host`, from the list (kept a few seconds); none when the vault doesn't answer. */
  private async candidates(host: string): Promise<Candidate[]> {
    const now = Date.now();
    if (!this.listed || now - this.listed.at > LIST_MS) {
      this.listed = { at: now, items: this.options.tokens.list().catch(() => []) };
    }
    const items = await this.listed.items;
    return items.filter((item) => hostListed(item.hosts, host)).map(({ name, headers }) => ({ name, headers }));
  }

  private accept(client: net.Socket): void {
    if (this.closed || this.connections >= MAX_CONNECTIONS) {
      client.destroy();
      return;
    }
    this.connections++;
    client.once("close", () => this.connections--);
    client.on("error", () => client.destroy());
    let head = Buffer.alloc(0);
    const timer = setTimeout(() => client.destroy(), HEAD_MS);
    const onData = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > MAX_HEAD) client.end(refusal(431, "Request Header Fields Too Large"));
        return;
      }
      client.off("data", onData);
      client.pause();
      clearTimeout(timer);
      const rest = head.subarray(end + 4);
      const request = parseConnect(head.subarray(0, end).toString("latin1"));
      if ("error" in request) {
        client.end(refusal(request.error, request.reason));
        return;
      }
      if (!authorized(request.auth, this.options.key)) {
        client.end(refusal(407, "Proxy Authentication Required", 'Proxy-Authenticate: Basic realm="dashi"\r\n'));
        return;
      }
      void this.route(request.host, request.port)
        .then((target) => this.join(client, target, rest))
        .catch(() => client.end(refusal(502, "Bad Gateway")));
    };
    client.on("data", onData);
  }

  /** Where a CONNECT goes: this sandbox's TLS server for a listed host on 443, else the host itself. */
  private async route(host: string, port: number): Promise<net.NetConnectOpts> {
    if (port === 443 && isHostName(host) && (await this.candidates(host)).length > 0) {
      return { path: (await this.terminator(host)).path };
    }
    return { host, port };
  }

  private join(client: net.Socket, target: net.NetConnectOpts, rest: Buffer): void {
    if (client.destroyed) return;
    const upstream = net.connect(target, () => {
      client.write(ESTABLISHED);
      if (rest.length > 0) upstream.write(rest);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
    upstream.once("error", () => {
      if (upstream.connecting) client.end(refusal(502, "Bad Gateway"));
      else client.destroy();
    });
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  }

  /** The TLS server that stands in for `host`, made on first use and again before its certificate gets old. */
  private terminator(host: string): Promise<Terminator> {
    const existing = this.terminators.get(host);
    const fresh = existing?.then((t) => (t.notAfter.getTime() - Date.now() > RENEW_MS ? t : null));
    const made = (fresh ?? Promise.resolve(null)).then(async (t) => {
      if (t) return t;
      if (existing) void existing.then((old) => this.stop(old, false)).catch(() => {});
      return this.serve(host, await issueLeaf(this.options.ca, host));
    });
    this.terminators.set(host, made);
    made.catch(() => this.terminators.delete(host));
    return made;
  }

  private serve(host: string, leaf: Issued): Terminator {
    const path = join(this.options.dir, `h${++this.serial}.sock`);
    if (existsSync(path)) unlinkSync(path);
    // A model's answer can stream slowly; the client decides when a connection is done. Bun
    // applies its 10 s idle timeout to unix sockets too, though its types leave the option out there.
    const options: object = {
      unix: path,
      tls: { key: leaf.key, cert: leaf.cert },
      idleTimeout: 0,
      fetch: (request: Request) => this.forward(host, request),
      error: () => new Response("Dashi's token proxy failed\n", { status: 502 }),
    };
    const server = Bun.serve(options as Parameters<typeof Bun.serve>[0]);
    return { path, server, notAfter: leaf.notAfter };
  }

  private stop(terminator: Terminator, now = true): void {
    void terminator.server.stop(now);
    if (existsSync(terminator.path)) unlinkSync(terminator.path);
  }

  /** One request to a listed host: its tokens put in, sent on over verified TLS, the answer streamed back. */
  async forward(host: string, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const base = this.options.upstream?.(host) ?? `https://${host}`;
    const headers = forwardHeaders(request.headers);
    headers.delete("host");
    // The answer goes back as it came; a client that asked for no encoding gets none.
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    const tokens = new Map<string, { token: string; headers: readonly string[] }>();
    for (const candidate of wanted(headers, await this.candidates(host))) {
      try {
        const { token, headers: specs } = await this.options.tokens.forHost(candidate.name, host);
        tokens.set(candidate.name, { token: new TextDecoder().decode(token), headers: specs });
        token.fill(0);
        this.note(candidate.name, host);
      } catch {
        // Locked, deleted, or no longer for this host: the placeholder goes as it is.
      }
    }
    const send = this.options.fetch ?? fetch;
    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    try {
      const response = await send(`${base}${url.pathname}${url.search}`, {
        method: request.method,
        headers: swapHeaders(headers, tokens),
        ...(hasBody ? { body: request.body, duplex: "half" } : {}),
        // A redirect is the client's to follow, through this proxy again: never with the token to another host.
        redirect: "manual",
        decompress: false,
        tls: { rejectUnauthorized: true },
      } as RequestInit);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: backHeaders(response.headers) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return new Response(`Dashi's token proxy couldn't reach ${host}: ${reason}\n`, { status: 502, headers: { "content-type": "text/plain" } });
    } finally {
      tokens.clear();
    }
  }

  private note(name: string, host: string): void {
    const key = `${name}\n${host}`;
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.options.used?.(name, host);
  }
}
