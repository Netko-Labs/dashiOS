/**
 * greetd's IPC (greetd-ipc(7)): on `$GREETD_SOCK`, each message is its JSON
 * length as a 32-bit unsigned integer in native byte order, then the JSON.
 * The greeter asks; greetd answers each request with one response.
 */

export type Request =
  | { type: "create_session"; username: string }
  | { type: "post_auth_message_response"; response?: string }
  | { type: "start_session"; cmd: string[]; env: string[] }
  | { type: "cancel_session" };

export type AuthMessageType = "visible" | "secret" | "info" | "error";

export type Response =
  | { type: "success" }
  | { type: "error"; errorType: "auth_error" | "error"; description: string }
  | { type: "auth_message"; messageType: AuthMessageType; message: string };

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** One request on the wire: length, then JSON. */
export function encode(request: Request): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(request));
  const frame = new Uint8Array(4 + json.length);
  new DataView(frame.buffer).setUint32(0, json.length, LITTLE_ENDIAN);
  frame.set(json, 4);
  return frame;
}

/** Splits a byte stream into the JSON payloads of whole frames. */
export class FrameReader {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    const payloads: string[] = [];
    let offset = 0;
    while (joined.length - offset >= 4) {
      const length = new DataView(joined.buffer, offset, 4).getUint32(0, LITTLE_ENDIAN);
      if (joined.length - offset - 4 < length) break;
      payloads.push(new TextDecoder().decode(joined.subarray(offset + 4, offset + 4 + length)));
      offset += 4 + length;
    }
    this.buffer = joined.slice(offset);
    return payloads;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A response from greetd; null for anything that is not one. */
export function parseResponse(json: string): Response | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "success":
      return { type: "success" };
    case "error":
      return {
        type: "error",
        errorType: value.error_type === "auth_error" ? "auth_error" : "error",
        description: typeof value.description === "string" ? value.description : "",
      };
    case "auth_message": {
      const kind = value.auth_message_type;
      if (kind !== "visible" && kind !== "secret" && kind !== "info" && kind !== "error") return null;
      return { type: "auth_message", messageType: kind, message: typeof value.auth_message === "string" ? value.auth_message : "" };
    }
    default:
      return null;
  }
}
