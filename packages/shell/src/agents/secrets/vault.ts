/**
 * The shell's client of dashi-secretd (docs/secrets.md, "The socket
 * protocol"): one connection per request, a JSON line each way. Secrets come
 * back as bytes for the broker to type and drop; they are never logged, and
 * errors carry dashi-secretd's words, which never hold one.
 */

import { LineBuffer } from "../../lines.ts";

export const VAULT_SOCKET = process.env.DASHI_SECRETD_SOCKET || "/run/dashi-secretd/socket";
const TIMEOUT_MS = 10_000;

export type AgentUse = "ask" | "never";

/** A login as anyone may see it: no password, no code secret. */
export interface LoginSummary {
  id: number;
  site: string;
  account: string;
  agents: AgentUse;
  hasCode: boolean;
  lastUsed: number | null;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const encodeText = (text: string): string => toBase64(new TextEncoder().encode(text));

function fromBase64(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new Error("dashi-secretd answered without the secret");
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** One request, one reply; rejects with dashi-secretd's error. */
export async function vaultCall(request: Record<string, unknown>, path = VAULT_SOCKET, timeoutMs = TIMEOUT_MS): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const lines = new LineBuffer();
    let settled = false;
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const timer = setTimeout(() => finish(new Error("dashi-secretd didn't answer")), timeoutMs);
    Bun.connect({
      unix: path,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(request)}\n`);
        },
        data(socket, chunk) {
          for (const line of lines.push(chunk)) {
            let reply: unknown;
            try {
              reply = JSON.parse(line);
            } catch {
              finish(new Error("dashi-secretd answered nonsense"));
              socket.end();
              return;
            }
            const record = typeof reply === "object" && reply !== null ? (reply as Record<string, unknown>) : {};
            if (record.ok === true) finish(null, record);
            else finish(new Error(typeof record.error === "string" ? record.error : "dashi-secretd refused"));
            socket.end();
            return;
          }
        },
        close() {
          finish(new Error("dashi-secretd closed the connection"));
        },
        error(_socket, error) {
          finish(error);
        },
      },
    }).catch((error: unknown) => finish(new Error(`Dashi's vault is not running (${error instanceof Error ? error.message : String(error)})`)));
  });
}

function parseLogin(value: unknown): LoginSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, site, account, agents, hasCode, lastUsed } = value as Record<string, unknown>;
  if (typeof id !== "number" || typeof site !== "string" || typeof account !== "string") return null;
  return {
    id,
    site,
    account,
    agents: agents === "never" ? "never" : "ask",
    hasCode: hasCode === true,
    lastUsed: typeof lastUsed === "number" ? lastUsed : null,
  };
}

export interface NewLogin {
  site: string;
  account: string;
  password: string;
  /** base32, or an otpauth:// address. */
  totp?: string;
  agents?: AgentUse;
}

/** Dashi's vault, as the shell uses it. */
export class Vault {
  constructor(private readonly path = VAULT_SOCKET) {}

  private call(request: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    return vaultCall(request, this.path, timeoutMs);
  }

  async status(): Promise<{ exists: boolean; unlocked: boolean; tpm: boolean | null }> {
    const reply = await this.call({ op: "status" });
    return { exists: reply.exists === true, unlocked: reply.unlocked === true, tpm: typeof reply.tpm === "boolean" ? reply.tpm : null };
  }

  async logins(site?: string): Promise<LoginSummary[]> {
    const reply = await this.call({ op: "logins", ...(site ? { site } : {}) });
    return (Array.isArray(reply.logins) ? reply.logins : []).map(parseLogin).filter((l): l is LoginSummary => l !== null);
  }

  /** The password, for the broker to type; `forAgent` refuses a "Never" login. */
  async password(id: number, forAgent: boolean): Promise<Uint8Array> {
    return fromBase64((await this.call({ op: "reveal-password", id, forAgent })).password);
  }

  /** The login's one-time code now. */
  async code(id: number, forAgent: boolean): Promise<string> {
    return new TextDecoder().decode(fromBase64((await this.call({ op: "code", id, forAgent })).code));
  }

  async save(login: NewLogin): Promise<number> {
    const reply = await this.call({
      op: "save-login",
      site: login.site,
      account: login.account,
      password: encodeText(login.password),
      ...(login.totp ? { totp: encodeText(login.totp) } : {}),
      agents: login.agents ?? "ask",
    });
    return typeof reply.id === "number" ? reply.id : -1;
  }

  async setAgents(id: number, agents: AgentUse): Promise<void> {
    await this.call({ op: "update-login", id, agents });
  }

  async remove(id: number): Promise<void> {
    await this.call({ op: "delete-login", id });
  }

  /** The cards, by their last four digits; never a number. */
  async cards(): Promise<CardSummary[]> {
    const reply = await this.call({ op: "cards" });
    return (Array.isArray(reply.cards) ? reply.cards : []).flatMap((value: unknown) => {
      if (typeof value !== "object" || value === null) return [];
      const { id, label, last4, expiry, singleUse, used } = value as Record<string, unknown>;
      if (typeof id !== "number" || typeof last4 !== "string") return [];
      return [
        {
          id,
          label: typeof label === "string" ? label : "",
          last4,
          expiry: typeof expiry === "string" ? expiry : "",
          singleUse: singleUse === true,
          used: used === true,
        },
      ];
    });
  }

  async saveCard(card: { label: string; number: string; expiry: string; cvc: string; singleUse: boolean }): Promise<void> {
    await this.call({
      op: "save-card",
      label: card.label,
      number: encodeText(card.number.replace(/\s/g, "")),
      expiry: card.expiry,
      cvc: encodeText(card.cvc),
      singleUse: card.singleUse,
    });
  }

  async removeCard(id: number): Promise<void> {
    await this.call({ op: "delete-card", id });
  }

  async spending(): Promise<{ perPayment: number; perMonth: number; spentThisMonth: number }> {
    const reply = await this.call({ op: "spending" });
    const n = (value: unknown) => (typeof value === "number" ? value : 0);
    return { perPayment: n(reply.perPayment), perMonth: n(reply.perMonth), spentThisMonth: n(reply.spentThisMonth) };
  }

  async setLimits(perPayment: number, perMonth: number, password: string): Promise<void> {
    await this.call({ op: "set-limits", perPayment, perMonth, password: encodeText(password) });
  }

  /**
   * Pay: dashi-secretd checks the limits and asks the person (finger or
   * password); then the card, for the broker to type and drop.
   */
  async pay(merchant: string, cents: number, card: number): Promise<{ number: Uint8Array; cvc: Uint8Array; expiry: string }> {
    const reply = await this.call({ op: "pay", merchant, cents, card }, PAY_TIMEOUT_MS);
    const both = fromBase64(reply.card);
    const cut = both.indexOf(10);
    const result = { number: both.slice(0, cut), cvc: both.slice(cut + 1), expiry: typeof reply.expiry === "string" ? reply.expiry : "" };
    both.fill(0);
    return result;
  }
}

/** A payment waits for the person (a minute at most, in dashi-secretd). */
const PAY_TIMEOUT_MS = 75_000;

export interface CardSummary {
  id: number;
  label: string;
  last4: string;
  expiry: string;
  singleUse: boolean;
  used: boolean;
}
