/**
 * The method calls a connection is waiting on: each has a serial, a timer,
 * and a promise settled by the reply (or by a timeout, or the connection
 * closing).
 */

import { DBusError, ERRORS } from "./errors.ts";
import { type Message, MessageType } from "./message.ts";

interface Pending {
  resolve(body: unknown[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingCalls {
  private serial = 0;
  private readonly waiting = new Map<number, Pending>();

  /** The serial for the next message we send; it wraps and never is zero. */
  nextSerial(): number {
    this.serial = this.serial >= 0xffffffff ? 1 : this.serial + 1;
    return this.serial;
  }

  /** Resolves with the reply to `serial`; `send` writes the frame once the wait is set up. */
  wait(serial: number, member: string, timeoutMs: number, send: () => void): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(serial);
        reject(new DBusError(ERRORS.noReply, `no reply to ${member} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(serial, { resolve, reject, timer });
      try {
        send();
      } catch (error) {
        clearTimeout(timer);
        this.waiting.delete(serial);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Hand a method return or error to the call waiting for it; a reply nobody waits for is dropped. */
  settle(message: Message): void {
    const serial = message.replySerial;
    const pending = serial === undefined ? undefined : this.waiting.get(serial);
    if (serial === undefined || !pending) return;
    this.waiting.delete(serial);
    clearTimeout(pending.timer);
    if (message.type === MessageType.MethodReturn) {
      pending.resolve(message.body);
    } else {
      const text = typeof message.body[0] === "string" ? message.body[0] : "";
      pending.reject(new DBusError(message.errorName ?? ERRORS.failed, text, message.body));
    }
  }

  /** The connection ended: every call still waiting fails. */
  rejectAll(error?: Error): void {
    for (const [serial, pending] of this.waiting) {
      clearTimeout(pending.timer);
      pending.reject(new DBusError(ERRORS.disconnected, error?.message ?? "the connection closed"));
      this.waiting.delete(serial);
    }
  }
}
