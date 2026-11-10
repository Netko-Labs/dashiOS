/**
 * Questions from dashi-secretd to the person (docs/secrets.md, "Asking the
 * person"): a passkey made or used, a payment. The shell keeps one
 * connection watching (`watch-approvals`), shows each question, and passes
 * back the person's password (dashi-secretd checks it) or their no. A
 * fingerprint is checked by dashi-secretd itself; then the question is
 * simply answered, and its sheet comes down.
 */

import { LineBuffer } from "../../shared/io/lines.ts";
import { VAULT_SOCKET, vaultCall } from "./vault.ts";

export interface Question {
  id: number;
  kind: "passkey-register" | "passkey-sign-in" | "pay";
  /** The site (a passkey's relying party, a payment's merchant). */
  rp: string;
  user: string;
  /** A payment's amount and currency, as dashi-secretd states them. */
  amount?: string;
}

export type Event = { event: "approve"; question: Question } | { event: "answered"; id: number };

/** One line from the watch, to an event; anything else is null. */
export function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "number") return null;
  if (record.event === "answered") return { event: "answered", id: record.id };
  if (record.event !== "approve") return null;
  const kind = record.kind;
  if (kind !== "passkey-register" && kind !== "passkey-sign-in" && kind !== "pay") return null;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string).replace(/\p{Cc}/gu, "").slice(0, 200) : "");
  return {
    event: "approve",
    question: { id: record.id, kind, rp: text("rp"), user: text("user"), ...(typeof record.amount === "string" ? { amount: text("amount") } : {}) },
  };
}

/** The sheet's words for a question. */
export function describe(question: Question): { title: string; detail: string } {
  switch (question.kind) {
    case "passkey-register":
      return { title: `Save a passkey for ${question.rp}?`, detail: `As ${question.user || "you"}. Touch the fingerprint reader, or type your password.` };
    case "passkey-sign-in":
      return { title: `Use your passkey for ${question.rp}?`, detail: `As ${question.user || "you"}. Touch the fingerprint reader, or type your password.` };
    case "pay":
      return { title: `Pay ${question.rp} ${question.amount ?? ""}?`.replace(/\s+\?$/, "?"), detail: "Touch the fingerprint reader, or type your password." };
  }
}

export interface ApprovalsUi {
  show(question: Question, answer: { approve(password: string): Promise<string | null>; deny(): void }): void;
  hide(id: number): void;
}

const RETRY_MS = 5_000;

/** Watch for questions until `stop`; reconnects when dashi-secretd restarts. */
export function watchApprovals(ui: ApprovalsUi, path = VAULT_SOCKET): { stop(): void } {
  let stopped = false;
  let socket: { end(): void } | null = null;
  const answer = (id: number) => ({
    async approve(password: string) {
      try {
        await vaultCall({ op: "approve", id, password: Buffer.from(password, "utf8").toString("base64") }, path);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    deny() {
      void vaultCall({ op: "deny", id }, path).catch(() => {});
    },
  });
  const connect = () => {
    if (stopped) return;
    const lines = new LineBuffer();
    Bun.connect({
      unix: path,
      socket: {
        open(s) {
          socket = s;
          s.write(`${JSON.stringify({ op: "watch-approvals" })}\n`);
        },
        data(_s, chunk) {
          for (const line of lines.push(chunk)) {
            const event = parseEvent(line);
            if (event?.event === "approve") ui.show(event.question, answer(event.question.id));
            else if (event?.event === "answered") ui.hide(event.id);
          }
        },
        close() {
          socket = null;
          setTimeout(connect, RETRY_MS);
        },
        error() {},
      },
    }).catch(() => setTimeout(connect, RETRY_MS));
  };
  connect();
  return {
    stop() {
      stopped = true;
      socket?.end();
    },
  };
}
