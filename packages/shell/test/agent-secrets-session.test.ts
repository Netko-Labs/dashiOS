import { describe, expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { signInCall, UNCONFINED } from "../src/agents/desktop/secrets.ts";
import type { SignInAsk, Turn } from "../src/agents/presence.ts";
import { fromAnotherMachine, isConfined } from "../src/agents/sandbox.ts";
import { DEFAULT_PREFS, parsePrefs } from "../src/agents/secrets/preferences.ts";
import { SessionSecrets } from "../src/agents/secrets/session-secrets.ts";
import { isVaultWindow, vaultShown } from "../src/agents/secrets/vault-view.ts";
import type { Call } from "../src/agents/tools/index.ts";

describe("Settings › Passwords", () => {
  test("the sources and where new logins go: Dashi on, 1Password off, until chosen; nonsense is the default", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ sources: { "1password": true }, saveTo: "1password" })).toEqual({ sources: { dashi: true, "1password": true }, saveTo: "1password" });
    expect(parsePrefs({ sources: { dashi: "yes" }, saveTo: "elsewhere" })).toEqual(DEFAULT_PREFS);
  });

  test("the vault's window is blanked only while the Passwords pane shows", () => {
    const settings = { appId: "dev.dashi.settings" };
    expect(isVaultWindow(settings)).toBe(false);
    const gone = vaultShown();
    expect(isVaultWindow(settings)).toBe(true);
    expect(isVaultWindow({ appId: "firefox" })).toBe(false);
    gone();
    gone();
    expect(isVaultWindow(settings)).toBe(false);
  });
});

const who = () => ({ name: "claude", detail: "~/.local/bin/claude", claims: null, remote: false });
const NO_VAULT = {
  cards: async () => [],
  pay: async () => {
    throw new Error("no vault");
  },
};
const call = (name: Call["name"]): Call => ({ name, window: 3, site: "github.com", account: null, submit: false, reason: "x" }) as Call;

function deferred() {
  let resolve: (value: boolean) => void = () => {};
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("one connection's secrets", () => {
  test("a hand-over pauses the agent's other calls until Done, and blanks the window meanwhile", async () => {
    const turn = deferred();
    const turns: Turn[] = [];
    const handedOver = new Set<number>();
    const secrets = new SessionSecrets(
      { sources: () => [], atspi: async () => null, handedOver, filled: new Map(), vault: NO_VAULT },
      {
        signIn: async () => ({ allow: "deny", login: null }),
        turn: (t) => {
          turns.push(t);
          return turn.promise;
        },
      },
      true,
    );
    const run = secrets.run(1, who);
    const handing = secrets.around(call("hand_over"), () => run.handOver(3, "Sign in to your bank"));
    await Bun.sleep(0);
    expect(handedOver.has(3)).toBe(true);
    expect(turns[0]?.reason).toBe("Sign in to your bank");
    let screenshot = false;
    const later = secrets.around(call("screenshot"), async () => {
      screenshot = true;
    });
    await Bun.sleep(5);
    expect(screenshot).toBe(false);
    turn.resolve(true);
    expect(await handing).toBe(true);
    await later;
    expect(screenshot).toBe(true);
    expect(handedOver.has(3)).toBe(false);
  });

  test("a sign-in runs alone: the agent's own click waits for it", async () => {
    const secrets = new SessionSecrets(
      { sources: () => [], atspi: async () => null, handedOver: new Set(), filled: new Map(), vault: NO_VAULT },
      { signIn: async () => ({ allow: "deny", login: null }), turn: async () => true },
      true,
    );
    const order: string[] = [];
    let finish = () => {};
    const signing = secrets.around(
      call("sign_in"),
      () =>
        new Promise<void>((r) => {
          finish = () => {
            order.push("signed in");
            r();
          };
        }),
    );
    const click = secrets.around(call("click"), async () => void order.push("clicked"));
    await Bun.sleep(5);
    expect(order).toEqual([]);
    finish();
    await Promise.all([signing, click]);
    expect(order).toEqual(["signed in", "clicked"]);
  });

  test("the sheet is asked with who is asking", async () => {
    const asked: SignInAsk[] = [];
    const secrets = new SessionSecrets(
      { sources: () => [], atspi: async () => null, handedOver: new Set(), filled: new Map(), vault: NO_VAULT },
      {
        signIn: async (ask) => {
          asked.push(ask);
          return { allow: "once", login: "dashi:1" };
        },
        turn: async () => true,
      },
      true,
    );
    const answer = await secrets.run(7, who).ask("sign in to github.com", [{ key: "dashi:1", account: "alexk", site: "github.com", source: "Dashi" }]);
    expect(answer).toEqual({ allow: "once", login: "dashi:1" });
    expect(asked[0]).toMatchObject({ agent: 7, summary: "sign in to github.com", who: { name: "claude" } });
  });
});

describe("only confined agents sign in", () => {
  test("an agent outside the sandbox is told how to get in, and nothing is looked at", async () => {
    let looked = false;
    const ctx = {
      secrets: { confined: false },
      compositor: {
        windows: async () => {
          looked = true;
          return [];
        },
      },
    } as unknown as RunContext;
    const result = await signInCall(call("sign_in") as Extract<Call, { name: "sign_in" }>, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: "text", text: UNCONFINED });
    expect(looked).toBe(false);
  });

  test("confined: in an agent scope, or over SSH from another machine (not this one)", () => {
    const files: Record<string, string> = {
      "/proc/10/cgroup": "0::/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-claude-9.scope\n",
      "/proc/11/cgroup": "0::/user.slice/user-1000.slice/session-2.scope\n",
      "/proc/12/environ": "HOME=/home/alex\0SSH_CONNECTION=10.0.2.2 51234 10.0.2.15 22\0",
      "/proc/13/environ": "SSH_CONNECTION=127.0.0.1 40000 127.0.0.1 22\0",
    };
    const read = (path: string) => files[path] ?? null;
    expect(isConfined(read, 10, false)).toBe(true);
    expect(isConfined(read, 11, false)).toBe(false);
    expect(isConfined(read, 12, true)).toBe(true);
    expect(isConfined(read, 13, true)).toBe(false);
    expect(isConfined(read, 99, false)).toBe(false);
    expect(fromAnotherMachine("192.168.1.5 1 192.168.1.5 22")).toBe(false);
    expect(fromAnotherMachine(null)).toBe(false);
  });
});
