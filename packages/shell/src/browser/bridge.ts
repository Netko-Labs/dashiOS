/**
 * The shell's end of Dashi's browser extension (docs/actions.md, "Websites"):
 * `$XDG_RUNTIME_DIR/dashi-browser.sock`, which dashi-browser-host joins for
 * the extension that started it. Only that host may connect (its peer is
 * checked: Dashi's host script, outside any agent's sandbox, which can't
 * see the socket anyway: agents/sandbox.ts). Requests go out with an id and
 * wait for the extension's one answer.
 */

import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { peerPid } from "../agents/peer.ts";
import { inAgentScope } from "../agents/sandbox.ts";
import { LineBuffer } from "../shared/io/lines.ts";
import { EXTENSION_ID } from "./native.ts";
import { type BrowserMethod, type HostHello, parseFromBrowser } from "./protocol.ts";

/** The socket's name in $XDG_RUNTIME_DIR. */
export const BROWSER_SOCKET = "dashi-browser.sock";
/** What a request waits for the extension, at most (a load is 30 s of it). */
const REQUEST_MS = 45_000;
const MAX_LINE = 64 * 1024 * 1024;

export class BrowserError extends Error {}

/** One browser's extension, through its host. */
export interface BrowserLink {
  readonly hello: HostHello;
  /** One request to the extension, and its answer (named apart from the compositor's `request`: ipc-contract.test.ts). */
  ask(method: BrowserMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
}

export interface BrowserBridge {
  /** The extension that joined last and is still there; null without one. */
  current(): BrowserLink | null;
  /** Until an extension joins (a browser just started), at most `ms`. */
  whenConnected(ms: number): Promise<BrowserLink | null>;
  close(): void;
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Whether the process on the other end is Dashi's browser host, outside an agent's sandbox. */
export function isBrowserHost(cmdline: string | null, cgroup: string | null): boolean {
  if (cmdline === null || cgroup === null || inAgentScope(cgroup)) return false;
  return cmdline.split("\0").some((arg) => arg.endsWith("/dashi-browser-host.ts"));
}

class Link {
  hello: HostHello | null = null;
  private nextId = 0;
  private readonly waiting = new Map<number, { resolve(result: Record<string, unknown>): void; reject(error: Error): void; timer: Timer }>();
  readonly lines = new LineBuffer();

  constructor(private readonly write: (text: string) => void) {}

  ask(method: BrowserMethod, params: Record<string, unknown>, timeoutMs = REQUEST_MS): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new BrowserError("The browser didn't answer in time."));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  receive(line: string): void {
    const message = parseFromBrowser(line);
    if (message.kind === "hello") {
      if (message.hello.extension === EXTENSION_ID) this.hello = message.hello;
      return;
    }
    if (message.kind !== "reply") return;
    const waiter = this.waiting.get(message.reply.id);
    if (!waiter) return;
    this.waiting.delete(message.reply.id);
    clearTimeout(waiter.timer);
    if (message.reply.ok) waiter.resolve(message.reply.result);
    else waiter.reject(new BrowserError(message.reply.error));
  }

  gone(): void {
    for (const waiter of this.waiting.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new BrowserError("The browser closed."));
    }
    this.waiting.clear();
  }
}

export function startBrowserBridge(runtime = process.env.XDG_RUNTIME_DIR): BrowserBridge {
  const links: Link[] = [];
  let joined: Array<() => void> = [];
  const current = (): BrowserLink | null => {
    const link = [...links].reverse().find((candidate) => candidate.hello !== null);
    return link?.hello ? { hello: link.hello, ask: (method, params, timeoutMs) => link.ask(method, params, timeoutMs) } : null;
  };
  if (!runtime) return { current: () => null, whenConnected: async () => null, close() {} };
  const path = join(runtime, BROWSER_SOCKET);
  if (existsSync(path)) unlinkSync(path);
  const server = Bun.listen<{ link?: Link }>({
    unix: path,
    socket: {
      open(socket) {
        const fd = (socket as unknown as { fd?: number }).fd;
        const pid = typeof fd === "number" ? peerPid(fd) : null;
        if (pid === null || !isBrowserHost(read(`/proc/${pid}/cmdline`), read(`/proc/${pid}/cgroup`))) {
          socket.terminate();
          return;
        }
        const link = new Link((text) => socket.write(text));
        socket.data = { link };
        links.push(link);
      },
      data(socket, data) {
        const link = socket.data?.link;
        if (!link) return;
        const lines = link.lines.push(data);
        if (link.lines.pending > MAX_LINE) {
          socket.terminate();
          return;
        }
        const before = link.hello;
        for (const line of lines) if (line.trim()) link.receive(line);
        if (!before && link.hello) {
          const waiters = joined;
          joined = [];
          for (const wake of waiters) wake();
        }
      },
      close(socket) {
        const link = socket.data?.link;
        if (!link) return;
        link.gone();
        links.splice(links.indexOf(link), 1);
      },
      error() {},
    },
  });
  chmodSync(path, 0o600);
  return {
    current,
    whenConnected: async (ms) => {
      const now = current();
      if (now) return now;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        joined.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      return current();
    },
    close() {
      server.stop(true);
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
