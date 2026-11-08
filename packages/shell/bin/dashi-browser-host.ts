#!/usr/bin/env bun
/**
 * dashi-browser-host: the native messaging host of Dashi's browser extension
 * (docs/actions.md, "Websites"). The browser starts it when the extension
 * connects (manifest: spin/dashi-helium, `dev.dashi.browser`, allowed only
 * for Dashi's extension id); it joins the shell's socket,
 * `$XDG_RUNTIME_DIR/dashi-browser.sock`, and relays: the shell's requests to
 * the extension, the extension's answers to the shell. It takes requests
 * from nowhere else, and only serves the extension whose id it pins.
 *
 * While the shell isn't there (a session starting, restarting), it waits and
 * tries again; it ends when the browser closes its end.
 */

import { join } from "node:path";
import { callerExtension, encodeFrame, FrameReader } from "../src/browser/native.ts";

const VERSION = "0.5.0";
const RETRY_MS = 2_000;

const extension = callerExtension(process.argv.slice(2));
if (!extension) {
  console.error("dashi-browser-host: started by something other than Dashi's extension; ending");
  process.exit(1);
}

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const path = join(runtime, "dashi-browser.sock");

let shell: Bun.Socket<undefined> | null = null;
let pending = "";
let outbox: Promise<unknown> = Promise.resolve();

/** To the extension, in order. */
function toExtension(message: unknown): void {
  const frame = encodeFrame(message);
  if (!frame) {
    const id = typeof message === "object" && message !== null ? (message as { id?: unknown }).id : undefined;
    if (typeof id === "number") toShell({ id, ok: false, error: "That request is too large for the browser." });
    return;
  }
  outbox = outbox.then(() => Bun.write(Bun.stdout, frame));
}

function toShell(message: unknown): void {
  shell?.write(`${JSON.stringify(message)}\n`);
}

/** Lines from the shell: each one request for the extension. */
function fromShell(data: Uint8Array): void {
  pending += new TextDecoder().decode(data);
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    newline = pending.indexOf("\n");
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as unknown;
      if (typeof message === "object" && message !== null && !Array.isArray(message)) toExtension(message);
    } catch {
      // Not JSON: dropped.
    }
  }
}

async function joinShell(): Promise<void> {
  for (;;) {
    try {
      shell = await Bun.connect({
        unix: path,
        socket: {
          data: (_socket, data) => fromShell(data),
          close: () => {
            shell = null;
            pending = "";
            setTimeout(() => void joinShell(), RETRY_MS);
          },
          error: () => {},
        },
      });
      toShell({ event: "host", browserPid: process.ppid, extension, version: VERSION });
      return;
    } catch {
      await Bun.sleep(RETRY_MS);
    }
  }
}

void joinShell();

const reader = new FrameReader();
try {
  for await (const chunk of Bun.stdin.stream()) {
    for (const message of reader.push(chunk)) toShell(message);
  }
} catch (error) {
  console.error(`dashi-browser-host: ${error instanceof Error ? error.message : String(error)}`);
}
await outbox;
process.exit(0);
