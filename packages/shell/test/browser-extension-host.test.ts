// The extension's port to Dashi's native host (browser-extension/src/background/host.ts).
import { afterAll, expect, test } from "bun:test";

type Listener = (message: unknown) => void;
type Handler = (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
const HOST_MODULE = new URL("../browser-extension/src/background/host.ts", import.meta.url).href;

/** A stand-in for chrome.runtime's port: what the host sends comes in through `receive`. */
function fakeChrome() {
  const posted: unknown[] = [];
  let onMessage: Listener = () => {};
  let dropped = false;
  const port = {
    onMessage: { addListener: (listener: Listener) => void (onMessage = listener) },
    onDisconnect: { addListener: () => {} },
    postMessage(message: unknown) {
      if (dropped) throw new Error("Attempting to use a disconnected port object");
      posted.push(message);
    },
  };
  const chrome = {
    runtime: { connectNative: () => port, getManifest: () => ({ version: "0.8.0" }), onStartup: { addListener: () => {} }, lastError: undefined },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  };
  return { chrome, posted, receive: (message: unknown) => onMessage(message), drop: () => void (dropped = true) };
}

const had = Reflect.get(globalThis, "chrome");
afterAll(() => void Reflect.set(globalThis, "chrome", had));

test("an answer for a host that went while the request ran is dropped, not thrown", async () => {
  const fake = fakeChrome();
  Reflect.set(globalThis, "chrome", fake.chrome);
  // By a path, not a literal: the extension is its own project (its `chrome` types are not the shell's).
  const { connectHost } = (await import(HOST_MODULE)) as { connectHost(handle: Handler): void };
  let finish: (result: Record<string, unknown>) => void = () => {};
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => void rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  connectHost(() => new Promise((resolve) => void (finish = resolve)));
  expect(fake.posted).toEqual([{ event: "hello", version: "0.8.0" }]);

  // A request arrives; the host goes before its answer is ready.
  fake.receive({ id: 1, method: "read-page", params: {} });
  fake.drop();
  finish({ text: "the page" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onRejection);
  expect(rejections).toEqual([]);
  expect(fake.posted).toHaveLength(1);
});
