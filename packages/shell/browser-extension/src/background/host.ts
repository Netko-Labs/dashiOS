/**
 * The port to Dashi's native host. Requests come only from it; a lost port
 * is opened again (at once after a drop, then less often while the host
 * can't start: another browser, Dashi not installed), and an alarm wakes the
 * worker to try while nothing else does.
 */

import { HOST } from "../host-name.ts";

type Handler = (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const RETRY_MS = [1_000, 5_000, 30_000, 60_000];

let port: chrome.runtime.Port | null = null;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function connectHost(handle: Handler): void {
  const open = () => {
    timer = null;
    if (port) return;
    const opened = chrome.runtime.connectNative(HOST);
    port = opened;
    const started = Date.now();
    opened.onMessage.addListener((message) => {
      failures = 0;
      if (!isRecord(message) || typeof message.id !== "number" || typeof message.method !== "string") return;
      const { id, method } = message;
      const params = isRecord(message.params) ? message.params : {};
      handle(method, params).then(
        (result) => opened.postMessage({ id, ok: true, result }),
        (error: unknown) => opened.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    });
    opened.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port === opened) port = null;
      // A host that lived a while was dropped (the session restarted): back at once. One that never started: wait longer each time.
      failures = Date.now() - started > 10_000 ? 0 : failures + 1;
      timer ??= setTimeout(open, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    });
    // The host speaks first only when asked; this tells it the extension's version.
    opened.postMessage({ event: "hello", version: chrome.runtime.getManifest().version });
  };
  open();
  chrome.runtime.onStartup.addListener(open);
  chrome.alarms.create("dashi-host", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(() => {
    if (!port && !timer) open();
  });
}
