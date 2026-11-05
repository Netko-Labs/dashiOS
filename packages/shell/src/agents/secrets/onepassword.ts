/**
 * 1Password as a login source (docs/secrets.md, "1Password"), through its
 * CLI's desktop app integration: `op` asks the 1Password app, which asks the
 * person to unlock it the first time. The shell is the broker: it runs as the
 * person, outside every agent sandbox (which hides 1Password's sockets and
 * the CLI's configuration), lists logins without their secrets, and reads one
 * item's password or code only after the person allowed that use, then types
 * it and drops it. A secret never goes on a command line.
 */

import { type Login, type LoginSource, sortLogins } from "./sources.ts";

export interface OpResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

/** Runs `op` with these arguments, `input` on its stdin. */
export type OpRunner = (args: readonly string[], input?: Uint8Array) => Promise<OpResult>;

const TIMEOUT_MS = 60_000;
/** The list is kept this long: listing asks nothing secret, but it is slow. */
const LIST_MS = 5 * 60_000;
/** A 1Password tag that keeps a login from agents. */
export const NEVER_TAG = "dashi-never";

export function opRunner(path: string): OpRunner {
  return async (args, input) => {
    const child = Bun.spawn([path, ...args], { stdin: input ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" });
    if (input && child.stdin) {
      child.stdin.write(input);
      void child.stdin.end();
    }
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { code, stdout: new Uint8Array(stdout), stderr };
  };
}

export interface OpItem {
  id: string;
  vault: string;
  account: string;
  hosts: string[];
  never: boolean;
}

function hostOf(href: string): string | null {
  try {
    const url = new URL(href.includes("://") ? href : `https://${href}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** `op item list --categories Login --format json`, to items; anything malformed is skipped. */
export function parseItems(value: unknown): OpItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    const vault = typeof item.vault === "object" && item.vault !== null ? (item.vault as Record<string, unknown>).id : null;
    if (typeof item.id !== "string" || typeof vault !== "string" || !/^[A-Za-z0-9]+$/.test(item.id) || !/^[A-Za-z0-9]+$/.test(vault)) return [];
    const urls = Array.isArray(item.urls) ? item.urls : [];
    const hosts = urls.flatMap((url: unknown) => {
      const href = typeof url === "object" && url !== null ? (url as Record<string, unknown>).href : null;
      const host = typeof href === "string" ? hostOf(href) : null;
      return host ? [host] : [];
    });
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return [
      {
        id: item.id,
        vault,
        account: typeof item.additional_information === "string" ? item.additional_information : "",
        hosts,
        never: tags.includes(NEVER_TAG),
      },
    ];
  });
}

const matches = (site: string, host: string) => host === site || host.endsWith(`.${site}`);

/** When each 1Password login was last used through Dashi (1Password's CLI doesn't say). */
export interface UsedStore {
  get(key: string): number | null;
  set(key: string, at: number): void;
}

export function onePasswordSource(op: OpRunner, used: UsedStore, now: () => number = Date.now): LoginSource & { invalidate(): void } {
  let cache: { at: number; items: OpItem[] } | null = null;
  const items = async (): Promise<OpItem[]> => {
    if (cache && now() - cache.at < LIST_MS) return cache.items;
    const result = await op(["item", "list", "--categories", "Login", "--format", "json"]);
    if (result.code !== 0) throw new Error("1Password didn't answer (is the app unlocked, with CLI integration on?)");
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(result.stdout));
    } catch {
      throw new Error("1Password answered nonsense");
    }
    cache = { at: now(), items: parseItems(parsed) };
    return cache.items;
  };
  const ref = (login: Login): { vault: string; item: string } => {
    const [vault, item] = login.id.split("/");
    if (login.source !== "1password" || !vault || !item || !/^[A-Za-z0-9]+$/.test(vault) || !/^[A-Za-z0-9]+$/.test(item)) {
      throw new Error("not a 1Password login");
    }
    return { vault, item };
  };
  const mark = (login: Login) => used.set(`1password:${login.id}`, Math.floor(now() / 1000));
  return {
    id: "1password",
    invalidate: () => {
      cache = null;
    },
    async logins(site) {
      const logins = (await items()).flatMap((item): Login[] => {
        const host = site === "" ? item.hosts[0] : item.hosts.find((h) => matches(site, h));
        if (!host) return [];
        const id = `${item.vault}/${item.id}`;
        // The CLI's list doesn't say whether an item has a code; fill_code finds out.
        return [
          {
            source: "1password",
            id,
            site: host,
            account: item.account,
            agents: item.never ? "never" : "ask",
            hasCode: true,
            lastUsed: used.get(`1password:${id}`),
          },
        ];
      });
      return sortLogins(logins);
    },
    async password(login) {
      if (login.agents === "never") throw new Error("agents may never use this login");
      const { vault, item } = ref(login);
      // One item, one field, for this one approved use.
      const result = await op(["read", "--no-newline", `op://${vault}/${item}/password`]);
      if (result.code !== 0 || result.stdout.length === 0) throw new Error("1Password didn't give that login's password (is the app unlocked?)");
      mark(login);
      return result.stdout;
    },
    async code(login) {
      if (login.agents === "never") throw new Error("agents may never use this login");
      const { vault, item } = ref(login);
      const result = await op(["item", "get", item, "--vault", vault, "--otp"]);
      const code = new TextDecoder().decode(result.stdout).trim();
      result.stdout.fill(0);
      if (result.code !== 0 || !/^\d{6,8}$/.test(code)) throw new Error("That 1Password login has no one-time code.");
      mark(login);
      return code;
    },
  };
}

/** A new login saved in 1Password: the item as a JSON template on stdin, never on the command line. */
export async function saveToOnePassword(op: OpRunner, login: { site: string; account: string; password: string }): Promise<void> {
  const template = {
    title: login.site,
    category: "LOGIN",
    urls: [{ href: `https://${login.site}`, primary: true }],
    fields: [
      { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: login.account },
      { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: login.password },
    ],
  };
  const input = new TextEncoder().encode(JSON.stringify(template));
  const result = await op(["item", "create", "--format", "json", "-"], input);
  input.fill(0);
  if (result.code !== 0) throw new Error("1Password didn't save the login (is the app unlocked?)");
}
