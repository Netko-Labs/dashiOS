import { describe, expect, test } from "bun:test";
import { defaultAction, domKey } from "../browser-extension/src/page/keys.ts";
import { browserWindowFor, viewportToWindow } from "../src/agents/desktop/lib/browser-field.ts";
import { DENIED_SOCKETS, type SandboxEnv, sandboxArgs } from "../src/agents/sandbox.ts";
import { checkField } from "../src/agents/secrets/field-check.ts";
import { covers, parseSiteGrants, type SiteAnswer, SiteConsent, SiteGrants, siteOf } from "../src/agents/sites.ts";
import { parseCall } from "../src/agents/tools/index.ts";
import { isBrowserHost } from "../src/browser/bridge.ts";
import { parseField, parseFromBrowser } from "../src/browser/protocol.ts";
import type { CompositorWindow } from "../src/compositor.ts";

describe("websites, one by one", () => {
  test("a page's site is its host without www, for web pages only", () => {
    expect(siteOf("https://www.bodytech.com.co/login?x=1")).toBe("bodytech.com.co");
    expect(siteOf("http://localhost:8080/")).toBe("localhost");
    expect(siteOf("chrome://newtab/")).toBeNull();
    expect(siteOf("file:///etc/passwd")).toBeNull();
    expect(siteOf("javascript:alert(1)")).toBeNull();
    expect(covers("bodytech.com.co", "login.bodytech.com.co")).toBe(true);
    expect(covers("bodytech.com.co", "evilbodytech.com.co")).toBe(false);
    expect(covers("login.bodytech.com.co", "bodytech.com.co")).toBe(false);
  });

  function consent(answers: Array<SiteAnswer | null>) {
    const grants = new SiteGrants(null);
    const asked: string[] = [];
    const sites = new SiteConsent(
      grants,
      () => "/usr/bin/claude",
      async (site) => {
        asked.push(site);
        return answers.length > 0 ? (answers.shift() as SiteAnswer | null) : "deny";
      },
    );
    return { grants, asked, sites };
  }

  test("the first use of a site asks; the same site (or a subdomain) doesn't again", async () => {
    const { asked, sites, grants } = consent(["once"]);
    expect(await sites.allow("bodytech.com.co")).toBe(true);
    expect(await sites.allow("bodytech.com.co")).toBe(true);
    expect(await sites.allow("www.bodytech.com.co")).toBe(true);
    expect(asked).toEqual(["bodytech.com.co"]);
    // Once: not kept for the next connection.
    expect(grants.has("/usr/bin/claude", "bodytech.com.co")).toBe(false);
  });

  test("a launcher run's turns share its sites: allowed once, its follow-up's connection doesn't ask again", async () => {
    const grants = new SiteGrants(null);
    const asked: string[] = [];
    const task = new Set<string>();
    const turn = () =>
      new SiteConsent(
        grants,
        () => "/usr/bin/codex",
        async (site) => {
          asked.push(site);
          return "once";
        },
        task,
      );
    expect(await turn().allow("signin.localhost")).toBe(true);
    expect(await turn().allow("signin.localhost")).toBe(true);
    expect(asked).toEqual(["signin.localhost"]);
    // Not kept beyond the task.
    expect(grants.has("/usr/bin/codex", "signin.localhost")).toBe(false);
  });

  test("another site asks again; a refusal holds for the connection", async () => {
    const { asked, sites } = consent(["once", "deny"]);
    expect(await sites.allow("example.com")).toBe(true);
    expect(await sites.allow("bank.example.org")).toBe(false);
    expect(await sites.allow("bank.example.org")).toBe(false);
    expect(asked).toEqual(["example.com", "bank.example.org"]);
    expect(sites.isRefused("bank.example.org")).toBe(true);
  });

  test("Always Allow is kept for the agent; no answer is remembered as nothing", async () => {
    const { asked, sites, grants } = consent([null, "always"]);
    expect(await sites.allow("example.com")).toBe(false);
    expect(await sites.allow("example.com")).toBe(true);
    expect(asked).toEqual(["example.com", "example.com"]);
    expect(grants.has("/usr/bin/claude", "shop.example.com")).toBe(true);
    expect(grants.has("/usr/bin/other", "example.com")).toBe(false);
  });

  test("calls waiting on the same site share one question", async () => {
    const { asked, sites } = consent(["once"]);
    expect(await Promise.all([sites.allow("example.com"), sites.allow("example.com")])).toEqual([true, true]);
    expect(asked).toEqual(["example.com"]);
  });

  test("sites.json keeps only real hosts", () => {
    const kept = parseSiteGrants({ agents: { a: { "example.com": 1, "not a host": 2, "x.y.z": 3 }, b: ["example.com"] } });
    expect([...(kept.get("a")?.keys() ?? [])]).toEqual(["example.com", "x.y.z"]);
    expect(kept.has("b")).toBe(false);
  });
});

describe("the website tools' arguments", () => {
  test("open_url takes http and https only", () => {
    expect(parseCall({ name: "open_url", arguments: { url: "bodytech.com.co" } })).toEqual({ name: "open_url", url: "https://bodytech.com.co/", tab: null });
    expect(parseCall({ name: "open_url", arguments: { url: "javascript:alert(1)" } })).toHaveProperty("arguments");
    expect(parseCall({ name: "open_url", arguments: { url: "file:///etc/shadow" } })).toHaveProperty("arguments");
  });

  test("refs and tabs", () => {
    expect(parseCall({ name: "click_element", arguments: { ref: 12, tab: "t4" } })).toEqual({ name: "click_element", ref: 12, tab: 4 });
    expect(parseCall({ name: "click_element", arguments: { ref: "[12]" } })).toEqual({ name: "click_element", ref: 12, tab: null });
    expect(parseCall({ name: "click_element", arguments: { ref: -1 } })).toHaveProperty("arguments");
    expect(parseCall({ name: "press", arguments: { keys: "⇧Tab Return" } })).toMatchObject({ name: "press", chords: [{ key: "Tab" }, { key: "Return" }] });
  });

  test("sign_in names a browser element or a window, not both", () => {
    expect(parseCall({ name: "sign_in", arguments: { ref: 9, site: "github.com" } })).toEqual({
      name: "sign_in",
      target: { ref: 9, tab: null },
      site: "github.com",
      account: null,
      submit: false,
    });
    expect(parseCall({ name: "sign_in", arguments: { window: "w3", site: "github.com" } })).toMatchObject({ target: { window: 3 } });
    expect(parseCall({ name: "sign_in", arguments: { window: "w3", ref: 9, site: "github.com" } })).toHaveProperty("arguments");
    expect(parseCall({ name: "fill_code", arguments: { site: "github.com" } })).toHaveProperty("arguments");
    expect(parseCall({ name: "pay", arguments: { ref: 4, tab: "t2", site: "shop.example", amount: "12.00" } })).toMatchObject({
      target: { ref: 4, tab: 2 },
      cents: 1200,
    });
  });
});

describe("the agent sandbox and the browser", () => {
  const env: SandboxEnv = { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" };
  const present = new Set([
    "/run/user/1000/dashi-mcp.sock",
    "/run/user/1000/dashi-browser.sock",
    "/run/user/1000/dashi-comp.sock",
    "/home/alex/.config/net.imput.helium",
    "/home/alex/.config/chromium/NativeMessagingHosts",
  ]);
  const args = sandboxArgs(["claude"], {
    env,
    exists: (path) => (present.has(path) ? (path.endsWith(".sock") ? "file" : "dir") : null),
    bwrap: "/usr/bin/bwrap",
    unit: "dashi-agent-claude-1.scope",
    bus: "/run/user/1000/dashi-agent/u/bus",
  });
  const bound = args.flatMap((arg, i) => (["--bind", "--ro-bind", "--dev-bind"].includes(arg) ? [args[i + 1] ?? ""] : []));

  test("the browser socket is never reachable: the runtime directory is emptied, and it never comes back", () => {
    expect(DENIED_SOCKETS).toContain("dashi-browser.sock");
    const emptied = args.findIndex((arg, i) => arg === "--tmpfs" && args[i + 1] === env.runtime);
    expect(emptied).toBeGreaterThan(0);
    for (const socket of DENIED_SOCKETS) expect(bound).not.toContain(`${env.runtime}/${socket}`);
    expect(bound).toContain(`${env.runtime}/dashi-mcp.sock`);
  });

  test("the browser's profile is hidden, and native hosts can't be added", () => {
    const tmpfs = args.flatMap((arg, i) => (arg === "--tmpfs" ? [args[i + 1]] : []));
    expect(tmpfs).toContain("/home/alex/.config/net.imput.helium");
    const readOnly = args.flatMap((arg, i) => (arg === "--ro-bind" ? [args[i + 1]] : []));
    expect(readOnly).toContain("/home/alex/.config/chromium/NativeMessagingHosts");
  });

  test("only Dashi's host, outside a sandbox, may join the shell's browser socket", () => {
    const host = ["/usr/libexec/dashi/bin/bun", "/usr/share/dashi/shell/bin/dashi-browser-host.ts", "chrome-extension://x/"].join("\0");
    const session = "0::/user.slice/user-1000.slice/session-2.scope\n";
    expect(isBrowserHost(host, session)).toBe(true);
    expect(isBrowserHost(host, "0::/user.slice/user@1000.service/app.slice/dashi-agent-claude-3.scope\n")).toBe(false);
    expect(isBrowserHost(["bun", "/tmp/evil.ts"].join("\0"), session)).toBe(false);
    expect(isBrowserHost(null, session)).toBe(false);
  });
});

describe("the field check through the extension", () => {
  const field = (kind: "password" | "text" | "other", documents: string[]) => ({
    focused: { kind, documents, rect: null, page: null },
    cmdline: ["/opt/helium/helium"],
  });

  test("a real password field on the site's page takes its password", () => {
    expect(checkField(field("password", ["https://github.com/login"]), "password", "github.com").ok).toBe(true);
    expect(checkField(field("text", ["https://github.com/login"]), "password", "github.com").ok).toBe(false);
    expect(checkField(field("password", ["https://evil.example/", "https://github.com/"]), "password", "github.com").ok).toBe(false);
    expect(checkField(field("text", ["https://github.com/sessions/two-factor"]), "code", "github.com").ok).toBe(true);
  });

  test("the extension's report parses; a broken one doesn't", () => {
    const tab = { id: 3, windowId: 1, active: true, title: "Sign in", url: "https://github.com/login" };
    const report = parseField({
      kind: "password",
      documents: ["https://github.com/login"],
      focused: true,
      rect: { x: 10, y: 20, width: 200, height: 30 },
      viewport: { width: 800, height: 600 },
      frameId: 0,
      tab,
    });
    expect(report?.kind).toBe("password");
    expect(parseField({ kind: "secret", documents: [], tab })).toBeNull();
    expect(parseField({ kind: "text", documents: [1], tab })).toBeNull();
    expect(parseFromBrowser('{"event":"host","browserPid":1,"extension":"x","version":"1"}').kind).toBe("invalid");
    expect(parseFromBrowser('{"id":4,"ok":false,"error":"no"}')).toEqual({ kind: "reply", reply: { id: 4, ok: false, error: "no" } });
  });

  test("a field is placed in the window's content below the toolbar, by the page's zoom", () => {
    expect(viewportToWindow({ x: 100, y: 50, width: 200, height: 20 }, { width: 1000, height: 600 }, { width: 1000, height: 680 })).toEqual({
      x: 100,
      y: 130,
      width: 200,
      height: 20,
    });
    expect(viewportToWindow({ x: 100, y: 50, width: 200, height: 20 }, { width: 800, height: 480 }, { width: 1000, height: 680 })).toEqual({
      x: 125,
      y: 142.5,
      width: 250,
      height: 25,
    });
  });

  test("the browser's window is its process's, by the tab's title when it has several", () => {
    const window = (id: number, pid: number, title: string, focused = false) => ({ id, pid, title, focused, state: "normal" }) as unknown as CompositorWindow;
    const windows = [window(1, 50, "Mail - Helium"), window(2, 99, "Sign in - Helium"), window(3, 99, "News - Helium", true)];
    expect(browserWindowFor(windows, 99, { title: "Sign in" })?.id).toBe(2);
    expect(browserWindowFor(windows, 99, { title: "Elsewhere" })).toBeNull();
    expect(browserWindowFor([window(4, 99, "Anything")], 99, { title: "Sign in" })?.id).toBe(4);
  });
});

describe("press", () => {
  test("keys as the page hears them, and what the browser does by default", () => {
    expect(domKey({ mods: [], key: "Return" })).toEqual({ key: "Enter", code: "Enter", keyCode: 13 });
    expect(domKey({ mods: ["shift"], key: "a" })).toMatchObject({ key: "A", code: "KeyA" });
    expect(defaultAction({ mods: [], key: "Return" }, true, false)).toBe("activate");
    expect(defaultAction({ mods: ["shift"], key: "Tab" }, true, false)).toBe("previous-field");
    expect(defaultAction({ mods: [], key: "Next" }, false, false)).toEqual({ scroll: "page-down" });
    expect(defaultAction({ mods: [], key: "Down" }, true, false)).toBeNull();
    expect(defaultAction({ mods: [], key: "space" }, false, true)).toBe("toggle");
    expect(defaultAction({ mods: ["ctrl"], key: "w" }, false, false)).toBeNull();
  });
});
