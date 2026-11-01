/**
 * The client half of the D-Bus SASL handshake, EXTERNAL only: the bus knows
 * who we are from the socket's peer credentials, and we confirm by naming our
 * uid (as hex-encoded ASCII). Pure state: bytes in, bytes out, no I/O.
 *
 *   C: \0AUTH EXTERNAL 31303030\r\n
 *   S: OK <server guid>\r\n
 *   C: BEGIN\r\n         (message traffic follows)
 *
 * A connection that will carry file descriptors (fds.ts) asks for them in
 * between: `NEGOTIATE_UNIX_FD`, answered `AGREE_UNIX_FD`.
 */

const encoder = new TextEncoder();
/** A line this long without a CRLF is not SASL. */
const MAX_LINE = 4096;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthStep {
  /** Bytes to write to the socket, if any. */
  send?: Uint8Array;
  /** The handshake is over; `rest` is whatever followed the server's last line. */
  done?: { guid: string; rest: Uint8Array };
}

export function hexOf(text: string): string {
  return Array.from(encoder.encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class ClientAuth {
  private buffered = new Uint8Array(0);
  private guid: string | null = null;

  /** `passFds` also asks the bus to carry file descriptors (`NEGOTIATE_UNIX_FD`) before `BEGIN`. */
  constructor(
    private readonly uid: number,
    private readonly passFds = false,
  ) {}

  /** The first bytes to send: the NUL credentials byte, then AUTH. */
  start(): Uint8Array {
    return encoder.encode(`\0AUTH EXTERNAL ${hexOf(String(this.uid))}\r\n`);
  }

  feed(chunk: Uint8Array): AuthStep {
    const joined = new Uint8Array(this.buffered.length + chunk.length);
    joined.set(this.buffered);
    joined.set(chunk, this.buffered.length);
    this.buffered = joined;
    const sends: Uint8Array[] = [];
    // One chunk can hold several lines (OK and AGREE_UNIX_FD often arrive together).
    for (;;) {
      const line = this.takeLine();
      if (line === null) return sends.length > 0 ? { send: joinBytes(sends) } : {};
      const step = this.onLine(line);
      if (step.send) sends.push(step.send);
      if (step.done) return { send: joinBytes(sends), done: { guid: step.done, rest: this.buffered.slice() } };
    }
  }

  /** The next CRLF-terminated line, removed from the buffer; null until one is complete. */
  private takeLine(): string | null {
    const bytes = this.buffered;
    let end = -1;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      if (bytes.length > MAX_LINE) throw new AuthError("server's reply is not a SASL line");
      return null;
    }
    if (end > MAX_LINE) throw new AuthError("server's reply line is too long");
    this.buffered = bytes.subarray(end + 2);
    return new TextDecoder().decode(bytes.subarray(0, end));
  }

  /** One server line; `done` carries the guid once the handshake is over. */
  private onLine(line: string): { send?: Uint8Array; done?: string } {
    const [command = "", argument = ""] = line.split(" ", 2);
    if (this.guid === null) {
      if (command === "OK") {
        if (!/^[0-9a-fA-F]*$/.test(argument)) throw new AuthError("server sent a malformed guid");
        if (!this.passFds) return { send: encoder.encode("BEGIN\r\n"), done: argument };
        this.guid = argument;
        return { send: encoder.encode("NEGOTIATE_UNIX_FD\r\n") };
      }
      if (command === "REJECTED") throw new AuthError(`server rejected EXTERNAL authentication (it offers: ${argument || "nothing"})`);
    } else {
      if (command === "AGREE_UNIX_FD") return { send: encoder.encode("BEGIN\r\n"), done: this.guid };
      if (command === "ERROR") throw new AuthError("the bus does not pass file descriptors");
    }
    throw new AuthError(`unexpected reply from the bus during authentication: ${command.slice(0, 32)}`);
  }
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
