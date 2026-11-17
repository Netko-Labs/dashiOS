/**
 * An extension's form in the launcher (frame L8), shell side whole: a real
 * TreeSession holds the tree and the fields' values, the launcher draws them.
 * A send with a required field empty shows what is missing and sends
 * nothing; filled, the extension hears `submit` with every value; a draft is
 * kept as it is typed and goes once the form was sent and the view closed.
 * And Connect: the first sign-in asks its one question, Return signs in.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { type Manifest, parseManifest, parseTree, type ViewShellMessage } from "@dashi/applet";
import { draftsInMemory } from "../src/applets/drafts.ts";
import type { SessionAccounts } from "../src/applets/lib/tree-accounts.ts";
import { TreeSession } from "../src/applets/lib/tree-session.ts";
import { problemsOf, valuesOf } from "../src/applets/lib/tree-form.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import { withLauncher } from "../src/launcher/keys.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

afterEach(() => unmountLauncher());

function manifest(): Manifest {
  const parsed = parseManifest({
    id: "dev.example.issues",
    name: "Issues",
    version: "0.1.0",
    dashi: ">=0.9",
    entry: "main.tsx",
    summary: "Files issues.",
    author: { name: "Alex Kim" },
    shows: ["launcher"],
    permissions: ["network:api.github.com", "account:github.com"],
    accounts: [{ provider: "github.com", scopes: ["repo"] }],
    commands: [{ id: "issue", title: "Create Issue", mode: "form" }],
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

const FORM = (() => {
  const parsed = parseTree({
    t: "Form",
    i: "f",
    p: { draft: true },
    c: [
      { t: "Dropdown", i: "repo", p: { name: "repo", title: "Repository", info: "The last one you used" }, c: [
        { t: "Option", i: "o1", p: { title: "alexk/dotfiles", value: "alexk/dotfiles" } },
        { t: "Option", i: "o2", p: { title: "alexk/notes", value: "alexk/notes" } },
      ] },
      { t: "TextField", i: "title", p: { name: "title", title: "Title", required: true, max: 20 } },
      { t: "TextArea", i: "body", p: { name: "body", title: "Description" } },
      { t: "TagPicker", i: "labels", p: { name: "labels", title: "Labels", value: ["bug"] }, c: [{ t: "Option", i: "o3", p: { title: "bug", value: "bug" } }] },
      { t: "ActionPanel", i: "ap", c: [
        { t: "Action", i: "send", p: { title: "Create Issue", kind: "submit" } },
        { t: "Action", i: "connect", p: { title: "Connect GitHub…", kind: "connect", target: "github.com" } },
      ] },
    ],
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
})();

function session(accounts?: SessionAccounts) {
  const sent: ViewShellMessage[] = [];
  const drafts = draftsInMemory();
  const view = new TreeSession(1, manifest(), null, {
    send: (message) => void sent.push(message),
    open: async () => ({ ok: true, text: "" }),
    copy: async () => true,
    setPreference: async () => true,
    preferences: async () => ({}),
    closed: () => {},
    now: () => 0,
    drafts,
    ...(accounts ? { accounts } : {}),
  });
  view.started("issue", {}, {});
  view.receive({ type: "tree", seq: 1, root: FORM });
  return { view, sent, drafts };
}

describe("a form's values and problems", () => {
  test("typed, else kept, else where it starts; required and max checked, the extension's own words kept", () => {
    const values = valuesOf(FORM, { title: "Fix" }, { body: "kept", labels: "not a list" });
    expect(values).toEqual({ repo: "alexk/dotfiles", title: "Fix", body: "kept", labels: ["bug"] });
    expect(problemsOf(FORM, { ...values, title: "" })).toEqual({ title: "Title is needed" });
    expect(problemsOf(FORM, { ...values, title: "x".repeat(21) })).toEqual({ title: "Title is at most 20 characters" });
  });
});

describe("the form in the launcher", () => {
  test("drawn as fields; ❖↩ is its send; ⇥ is the fields' while it shows", async () => {
    const { view } = session();
    const scope = treeScope("Create Issue", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id });
    for (const id of ["launcher:form", "launcher:form:repo:button", "launcher:form:title:input", "launcher:form:body:input", "launcher:form:labels:tag:bug", "launcher:form:draft"])
      expect(launcher.has(id)).toBe(true);
    expect(launcher.tree()).toContain("The last one you used");
    expect(launcher.tree()).toContain("Create Issue");
    expect(scope.form?.()).toBe(true);
    const binds = withLauncher({ rules: [] } as never, false, "none", { stopWork: false, form: true }).rules.map((rule) => rule.bind);
    expect(binds).not.toContain("launcher-tab");
    expect(binds).toContain("launcher-secondary");
  });

  test("a send with Title empty shows what is missing and sends nothing; filled, the values go; the draft goes after", async () => {
    const { view, sent, drafts } = session();
    const scope = treeScope("Create Issue", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id });
    await launcher.enter();
    expect(launcher.has("launcher:form:title:under")).toBe(true);
    expect(launcher.tree()).toContain("Title is needed");
    expect(sent.some((message) => message.type === "event" && message.on === "submit")).toBe(false);
    await launcher.emit({ type: "change", nodeId: launcher.node("launcher:form:title:input"), value: "The filter forgets" });
    expect(sent.at(-1)).toEqual({ type: "event", seq: 1, on: "change", node: "title", value: "The filter forgets" });
    expect(drafts.held.get("dev.example.issues/issue")?.title).toBe("The filter forgets");
    await launcher.emit({ type: "press", nodeId: launcher.node("launcher:form:repo:button") });
    await launcher.emit({ type: "press", nodeId: launcher.node("launcher:form:repo:option:alexk/notes") });
    await launcher.enter();
    expect(launcher.has("launcher:form:title:under")).toBe(false);
    expect(sent.at(-1)).toEqual({
      type: "event",
      seq: 1,
      on: "submit",
      node: "send",
      values: { repo: "alexk/notes", title: "The filter forgets", body: "", labels: ["bug"] },
    });
    view.receive({ type: "close", seq: 1 });
    expect(drafts.held.has("dev.example.issues/issue")).toBe(false);
  });

  test("a draft kept comes back when the form opens again", () => {
    const first = session();
    first.view.change("title", "Half written");
    // The same store: a new session reads what the first kept.
    const back = new TreeSession(2, manifest(), null, {
      send: () => {},
      open: async () => ({ ok: true, text: "" }),
      copy: async () => true,
      setPreference: async () => true,
      preferences: async () => ({}),
      closed: () => {},
      now: () => 0,
      drafts: first.drafts,
    });
    back.started("issue", {}, {});
    back.receive({ type: "tree", seq: 2, root: FORM });
    expect(back.snapshot().form?.values.title).toBe("Half written");
  });

  test("Connect asks once in the field; Return signs in", async () => {
    const asked: string[] = [];
    const accounts: SessionAccounts = {
      given: async () => ({}),
      rows: () => [{ provider: { id: "github.com", name: "GitHub", authorize: "", token: "", user: "", clientId: "Iv1.example", kept: "The key is in your keyring." }, id: "github.com", scopes: ["repo"], login: null, asked: asked.length > 0 }],
      agreed: (_, provider) => void asked.push(provider),
      connect: async () => ({ login: "alexk" }),
      paste: async () => ({ login: "alexk" }),
    };
    const { view } = session(accounts);
    const done = await view.act("connect");
    expect(done).toMatchObject({ kind: "confirm", provider: "github.com", yes: "Sign In" });
    const signedIn = await view.connect("github.com");
    expect(asked).toEqual(["github.com"]);
    expect(signedIn).toMatchObject({ kind: "done", close: true });
  });
});
