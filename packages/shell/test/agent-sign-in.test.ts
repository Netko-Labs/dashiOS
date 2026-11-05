import { describe, expect, test } from "bun:test";
import type { Focused } from "../src/agents/atspi/tree.ts";
import { type Approval, type BrokerContext, fillCode, ONCE_MS, type SignInAnswer, signIn } from "../src/agents/secrets/broker.ts";
import { checkField, devtoolsOpen, type FieldInfo, pageHost, siteMatches } from "../src/agents/secrets/field-check.ts";
import { describeForAgent, findLogins, type Login, type LoginSource, sortLogins } from "../src/agents/secrets/sources.ts";
import { parseSite } from "../src/agents/tools/secrets.ts";

const PASSWORD = "hunter2-Secret!";
const CODE = "492039";
const FIREFOX = ["/usr/lib64/firefox/firefox"];

function field(kind: Focused["kind"], documents: string[] = ["https://github.com/login"]): FieldInfo {
  return { focused: { kind, rect: null, page: null, documents }, cmdline: FIREFOX };
}

function login(over: Partial<Login> = {}): Login {
  return { source: "dashi", id: "1", site: "github.com", account: "alexk", agents: "ask", hasCode: true, lastUsed: null, ...over };
}

function source(id: "dashi" | "1password", logins: Login[], fails = false): LoginSource & { revealed: number } {
  const s = {
    id,
    revealed: 0,
    async logins(site: string) {
      if (fails) throw new Error("not running");
      return logins.filter((l) => site === "" || site === l.site || site.endsWith(`.${l.site}`));
    },
    async password() {
      s.revealed++;
      return new TextEncoder().encode(PASSWORD);
    },
    async code() {
      return CODE;
    },
  };
  return s;
}

interface Harness {
  ctx: BrokerContext;
  typed: unknown[];
  asked: Array<{ summary: string; logins: readonly unknown[] }>;
}

/** A broker context: `fields` is what each look at the focused field finds, in turn (the last repeats). */
function harness(options: { sources: LoginSource[]; fields: FieldInfo[]; answer?: SignInAnswer; approvals?: Map<string, Approval>; now?: number }): Harness {
  const typed: unknown[] = [];
  const asked: Harness["asked"] = [];
  let look = 0;
  const ctx: BrokerContext = {
    sources: options.sources,
    inspect: async () => options.fields[Math.min(look++, options.fields.length - 1)] as FieldInfo,
    type: async (payload) => void typed.push(payload),
    ask: async (summary, logins) => {
      asked.push({ summary, logins });
      return options.answer ?? { allow: "once", login: (logins[0] as { key: string }).key };
    },
    approvals: options.approvals ?? new Map(),
    status: () => {},
    now: () => options.now ?? 1_000_000,
    sleep: async () => {},
  };
  return { ctx, typed, asked };
}

const everything = (value: unknown) => JSON.stringify(value);

describe("signing an agent in", () => {
  test("it types the account, Tab, then the password into the password field, and says nothing secret", async () => {
    const dashi = source("dashi", [login()]);
    const h = harness({ sources: [dashi], fields: [field("text"), field("text"), field("password")] });
    const result = await signIn(h.ctx, "github.com", null, true);
    expect(result.isError).toBeUndefined();
    expect(h.typed).toEqual([{ keys: [{ text: "alexk" }, { name: "Tab" }] }, { keys: [{ text: PASSWORD }] }, { keys: [{ name: "Return" }] }]);
    expect(everything(result)).not.toContain(PASSWORD);
    expect(everything(result)).toContain("alexk");
    expect(h.asked[0]?.summary).toBe("sign in to github.com");
    // The sheet shows logins, never a secret.
    expect(everything(h.asked)).not.toContain(PASSWORD);
  });

  test("a page of another site, or a frame from one, gets nothing, and the person isn't asked", async () => {
    for (const documents of [
      ["https://github.com.evil.example/login"],
      ["https://github.com/login", "https://evil.example/"],
      ["http://github.com/login"],
      [],
    ]) {
      const dashi = source("dashi", [login()]);
      const h = harness({ sources: [dashi], fields: [field("password", documents)] });
      const result = await signIn(h.ctx, "github.com", null, false);
      expect(result.isError).toBe(true);
      expect(h.asked).toEqual([]);
      expect(h.typed).toEqual([]);
      expect(dashi.revealed).toBe(0);
    }
  });

  test("if Tab doesn't land on a password field, no password is typed (nor even fetched)", async () => {
    const dashi = source("dashi", [login()]);
    const h = harness({ sources: [dashi], fields: [field("text"), field("text"), field("text")] });
    const result = await signIn(h.ctx, "github.com", null, false);
    expect(result.isError).toBe(true);
    expect(everything(result)).toContain("Nothing secret was typed");
    expect(h.typed).toEqual([{ keys: [{ text: "alexk" }, { name: "Tab" }] }]);
    expect(dashi.revealed).toBe(0);
  });

  test("the page is checked again after the person answers: a page that changed meanwhile gets nothing", async () => {
    const dashi = source("dashi", [login()]);
    const h = harness({ sources: [dashi], fields: [field("password"), field("password", ["https://evil.example/"])] });
    expect((await signIn(h.ctx, "github.com", null, false)).isError).toBe(true);
    expect(h.asked.length).toBe(1);
    expect(dashi.revealed).toBe(0);
  });

  test('a login marked "Never" is refused; a denial types nothing', async () => {
    const never = harness({ sources: [source("dashi", [login({ agents: "never" })])], fields: [field("password")] });
    const refused = await signIn(never.ctx, "github.com", null, false);
    expect(everything(refused)).toContain("hand_over");
    expect(never.asked).toEqual([]);
    const denied = harness({ sources: [source("dashi", [login()])], fields: [field("password")], answer: { allow: "deny", login: null } });
    expect((await signIn(denied.ctx, "github.com", null, false)).isError).toBe(true);
    expect(denied.typed).toEqual([]);
  });

  test('"Allow for This Task" isn\'t asked again; "Allow Once" covers only its code, for two minutes', async () => {
    const approvals = new Map<string, Approval>();
    const task = harness({ sources: [source("dashi", [login()])], fields: [field("password")], approvals, answer: { allow: "task", login: "dashi:1" } });
    await signIn(task.ctx, "github.com", null, false);
    await signIn(task.ctx, "github.com", null, false);
    expect(task.asked.length).toBe(1);

    const once = new Map<string, Approval>();
    const first = harness({ sources: [source("dashi", [login()])], fields: [field("password")], approvals: once });
    await signIn(first.ctx, "github.com", null, false);
    const code = harness({ sources: [source("dashi", [login()])], fields: [field("text")], approvals: once });
    await fillCode(code.ctx, "github.com", null, false);
    expect(code.asked).toEqual([]);
    expect(code.typed).toEqual([{ keys: [{ text: CODE }] }]);
    // A second sign-in on that "once" asks again, and so does a code after two minutes.
    const again = harness({ sources: [source("dashi", [login()])], fields: [field("password")], approvals: once });
    await signIn(again.ctx, "github.com", null, false);
    expect(again.asked.length).toBe(1);
    const late = harness({ sources: [source("dashi", [login()])], fields: [field("text")], approvals: once, now: 1_000_000 + ONCE_MS + 1 });
    await fillCode(late.ctx, "github.com", null, false);
    expect(late.asked.length).toBe(1);
  });

  test("a one-time code goes into a text field of the site and is never in the result", async () => {
    const h = harness({ sources: [source("dashi", [login()])], fields: [field("text")] });
    const result = await fillCode(h.ctx, "github.com", null, true);
    expect(h.typed).toEqual([{ keys: [{ text: CODE }] }, { keys: [{ name: "Return" }] }]);
    expect(everything(result)).not.toContain(CODE);
    const noCode = harness({ sources: [source("dashi", [login({ hasCode: false })])], fields: [field("text")] });
    expect((await fillCode(noCode.ctx, "github.com", null, false)).isError).toBe(true);
  });

  test("a browser open to DevTools gets nothing", async () => {
    const h = harness({
      sources: [source("dashi", [login()])],
      fields: [{ ...field("password"), cmdline: ["/usr/bin/chromium", "--remote-debugging-port=9222"] }],
    });
    expect(everything(await signIn(h.ctx, "github.com", null, false))).toContain("remote debugging");
    expect(h.asked).toEqual([]);
  });
});

describe("logins from two sources", () => {
  test("the most recently used first, wherever it is saved; then Dashi before 1Password", () => {
    const sorted = sortLogins([
      login({ source: "1password", id: "a", account: "old", lastUsed: 10 }),
      login({ source: "dashi", id: "2", account: "never-used" }),
      login({ source: "1password", id: "b", account: "recent", lastUsed: 99 }),
      login({ source: "1password", id: "c", account: "never-used" }),
    ]);
    expect(sorted.map((l) => `${l.source}:${l.account}`)).toEqual(["1password:recent", "1password:old", "dashi:never-used", "1password:never-used"]);
  });

  test("the sheet lists both sources' logins, saying where each is from, the most recent first; the chosen one's source types it", async () => {
    const dashi = source("dashi", [login({ lastUsed: 100 })]);
    const op = source("1password", [login({ source: "1password", id: "v1/abc", account: "alex-op", lastUsed: 200 })]);
    const h = harness({ sources: [dashi, op], fields: [field("password")], answer: { allow: "once", login: "1password:v1/abc" } });
    await signIn(h.ctx, "github.com", null, false);
    expect(h.asked[0]?.logins).toEqual([
      { key: "1password:v1/abc", account: "alex-op", site: "github.com", source: "1Password" },
      { key: "dashi:1", account: "alexk", site: "github.com", source: "Dashi" },
    ]);
    expect([dashi.revealed, op.revealed]).toEqual([0, 1]);
  });

  test("a source that fails is left out and named", async () => {
    const { logins, failed } = await findLogins([source("dashi", [login()]), source("1password", [], true)], "github.com");
    expect(logins.length).toBe(1);
    expect(failed).toEqual(["1password"]);
  });

  test("an agent is told sites, accounts and sources, never a secret", () => {
    expect(describeForAgent(login({ source: "1password" }))).toEqual({
      source: "1Password",
      site: "github.com",
      account: "alexk",
      hasCode: true,
      agents: "ask",
    });
  });
});

describe("what a page and a site are", () => {
  test("sites are hosts", () => {
    expect(parseSite("https://www.GitHub.com/login")).toBe("github.com");
    expect(parseSite("ynab.com")).toBe("ynab.com");
    expect(parseSite("localhost")).toBeNull();
    expect(parseSite("not a site")).toBeNull();
    expect(parseSite(42)).toBeNull();
  });

  test("https pages, and http only on loopback names", () => {
    expect(pageHost("https://github.com/login")).toBe("github.com");
    expect(pageHost("http://github.com/login")).toBeNull();
    expect(pageHost("http://signin.localhost:8443/")).toBe("signin.localhost");
    expect(pageHost("file:///etc/passwd")).toBeNull();
    expect(pageHost("not a url")).toBeNull();
    expect(siteMatches("github.com", "gist.github.com")).toBe(true);
    expect(siteMatches("github.com", "evilgithub.com")).toBe(false);
  });

  test("DevTools flags, and a browser whose command line can't be read, are refused", () => {
    expect(devtoolsOpen(["chromium", "--remote-debugging-pipe"])).toBe(true);
    expect(devtoolsOpen(["firefox", "-marionette"])).toBe(true);
    expect(devtoolsOpen(["firefox", "--new-window"])).toBe(false);
    expect(checkField({ ...field("password"), cmdline: null }, "password", "github.com").ok).toBe(false);
  });
});
