/**
 * Native messaging, as Chromium speaks it to dashi-browser-host: each
 * message a 32-bit length in the machine's order (little-endian here) and
 * that many bytes of JSON. Messages to the extension are at most 1 MiB
 * (Chromium's limit); from it, Dashi takes at most 64 MiB.
 *
 * The host serves one extension: Dashi's, by its pinned id. Chromium passes
 * the caller's origin as the host's first argument, and the host's manifest
 * already allows only that id; the host checks again. Pure, so tested.
 */

/** Dashi's extension's id: from its manifest's key (browser-extension/manifest.json), pinned (test/browser-pinning.test.ts). */
export const EXTENSION_ID = "mngbphpldanjlpbagnkmfalmglolgkmb";

/** The native messaging host's name, in its manifest and the extension's connectNative. */
export const HOST_NAME = "dev.dashi.browser";

/** Chromium's limit on a message to the extension. */
export const MAX_TO_EXTENSION = 1024 * 1024;
/** What the host takes from the extension at most (a long page's text). */
export const MAX_FROM_EXTENSION = 64 * 1024 * 1024;

/** The extension id in the origin Chromium gave the host, if it is Dashi's. */
export function callerExtension(args: readonly string[]): string | null {
  const origin = args.find((arg) => arg.startsWith("chrome-extension://"));
  const match = origin ? /^chrome-extension:\/\/([a-p]{32})\/?$/.exec(origin) : null;
  return match?.[1] === EXTENSION_ID ? match[1] : null;
}

/** One message as a frame for the extension; null when it is over Chromium's limit. */
export function encodeFrame(message: unknown): Uint8Array | null {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.byteLength > MAX_TO_EXTENSION) return null;
  const frame = new Uint8Array(4 + body.byteLength);
  new DataView(frame.buffer).setUint32(0, body.byteLength, true);
  frame.set(body, 4);
  return frame;
}

/** Frames from the extension, as they arrive in pieces. */
export class FrameReader {
  private buffer = new Uint8Array(0);

  /** The messages the bytes so far complete; throws on a frame over the limit (the host then ends). */
  push(chunk: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.byteLength);
    this.buffer = joined;
    const out: unknown[] = [];
    for (;;) {
      if (this.buffer.byteLength < 4) break;
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(0, true);
      if (length > MAX_FROM_EXTENSION) throw new Error(`a frame of ${length} bytes is over the limit`);
      if (this.buffer.byteLength < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.slice(4 + length);
      try {
        out.push(JSON.parse(new TextDecoder().decode(body)));
      } catch {
        // Not JSON: dropped; the extension never sends that.
      }
    }
    return out;
  }
}
