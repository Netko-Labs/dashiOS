import { describe, expect, test } from "bun:test";
import { NEVER_TAG, type OpResult, onePasswordSource, parseItems, saveToOnePassword } from "../src/agents/secrets/onepassword.ts";
import { findLogins, loginKey } from "../src/agents/secrets/sources.ts";

const PASSWORD = "op-secret-Password!";

/** What `op item list --categories Login --format json` prints (trimmed to what Dashi reads). */
const LIST = [
  {
    id: "abc123",
    title: "GitHub",
    vault: { id: "v1", name: "Personal" },
    additional_information: "alexk",
    urls: [{ href: "https://github.com/login", primary: true }],
    tags: [],
  },
  { id: "def456", title: "Bank", vault: { id: "v1" }, additional_information: "4471", urls: [{ href: "https://bank.example" }], tags: [NEVER_TAG] },
  { id: "bad id!", vault: { id: "v1" }, urls: [{ href: "https://evil.example" }] },
  { id: "ghi789", vault: { id: "v2" }, additional_information: "alex-work", urls: [{ href: "gist.github.com" }] },
];

function fakeOp(options: { failList?: boolean } = {}) {
  const calls: Array<{ args: readonly string[]; input: string | null }> = [];
  const op = async (args: readonly string[], input?: Uint8Array): Promise<OpResult> => {
    calls.push({ args, input: input ? new TextDecoder().decode(input) : null });
    const out = (text: string, code = 0) => ({ code, stdout: new TextEncoder().encode(text), stderr: "" });
    if (args[0] === "item" && args[1] === "list") return options.failList ? out("", 1) : out(JSON.stringify(LIST));
    if (args[0] === "read") return args[2] === "op://v1/abc123/password" ? out(PASSWORD) : out("", 1);
    if (args[0] === "item" && args[1] === "get") return args[2] === "abc123" ? out("123456\n") : out("", 1);
    if (args[0] === "item" && args[1] === "create") return out("{}");
    return out("", 1);
  };
  const used = new Map<string, number>();
  const store = { get: (key: string) => used.get(key) ?? null, set: (key: string, at: number) => void used.set(key, at) };
  return { op, calls, used, source: onePasswordSource(op, store, () => 1_700_000_000_000) };
}

describe("1Password as a source", () => {
  test("items parse to logins, malformed ones skipped", () => {
    const items = parseItems(LIST);
    expect(items.map((i) => i.id)).toEqual(["abc123", "def456", "ghi789"]);
    expect(items[1]?.never).toBe(true);
    expect(parseItems("nope")).toEqual([]);
  });

  test("listing reads no secret, and matches the site and its subdomains", async () => {
    const { source, calls } = fakeOp();
    const logins = await source.logins("github.com");
    // Never used yet: by site, then account.
    expect(logins.map((l) => [l.id, l.account, l.site])).toEqual([
      ["v2/ghi789", "alex-work", "gist.github.com"],
      ["v1/abc123", "alexk", "github.com"],
    ]);
    expect(calls.map((c) => c.args.join(" "))).toEqual(["item list --categories Login --format json"]);
    expect(JSON.stringify(logins)).not.toContain(PASSWORD);
    // Listed once, for a while.
    await source.logins("bank.example");
    expect(calls.length).toBe(1);
  });

  test("one item's password, only when asked for it; tagged items are never for agents", async () => {
    const { source, calls, used } = fakeOp();
    const [bank] = await source.logins("bank.example");
    expect(bank?.agents).toBe("never");
    if (!bank) throw new Error("no bank");
    await expect(source.password(bank)).rejects.toThrow("never");
    const github = (await source.logins("github.com")).find((l) => l.id === "v1/abc123");
    if (!github) throw new Error("no login");
    expect(new TextDecoder().decode(await source.password(github))).toBe(PASSWORD);
    expect(calls.at(-1)?.args).toEqual(["read", "--no-newline", "op://v1/abc123/password"]);
    expect(await source.code(github)).toBe("123456");
    expect(used.get(`1password:${github.id}`)).toBe(1_700_000_000);
    // A made-up id can't reach another item, or the command line.
    await expect(source.password({ ...github, id: "v1/abc123 --reveal" })).rejects.toThrow();
  });

  test("a 1Password that doesn't answer leaves Dashi's logins listed", async () => {
    const { source } = fakeOp({ failList: true });
    const { logins, failed } = await findLogins([source], "github.com");
    expect(logins).toEqual([]);
    expect(failed).toEqual(["1password"]);
  });

  test("logins from both sources keep their own keys", async () => {
    const { source } = fakeOp();
    const login = (await source.logins("github.com")).find((l) => l.account === "alexk");
    expect(login && loginKey(login)).toBe("1password:v1/abc123");
  });

  test("a new login goes to 1Password on stdin, never on the command line", async () => {
    const { op, calls } = fakeOp();
    await saveToOnePassword(op, { site: "ynab.com", account: "alex@example.com", password: PASSWORD });
    expect(calls[0]?.args.join(" ")).not.toContain(PASSWORD);
    expect(calls[0]?.input).toContain(PASSWORD);
  });
});
