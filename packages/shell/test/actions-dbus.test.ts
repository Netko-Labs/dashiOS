import { expect, test } from "bun:test";
import { ACTIONS_INTERFACE, actionsInterface, argsFromVariants } from "../src/actions/dbus.ts";
import { ActionRegistry, fixedSource } from "../src/actions/registry.ts";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";
import { DBusError, Variant } from "../src/dbus/index.ts";
import { openTarget } from "../src/extensions/start.ts";

const action = (address: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  address,
  title: "Say hello",
  description: "Greets you",
  keywords: {},
  kind: "run",
  properties: { name: { type: "string" } },
  scope: null,
  readOnly: false,
  destructive: false,
  who: "person",
  source: "scripts",
  from: "Script",
  check: () => ready(async () => ok("Done.")),
  ...extra,
});

function service() {
  const registry = new ActionRegistry();
  registry.add(
    fixedSource("test", [
      action("dashi://script/hello.sh"),
      action("dashi://tool/screenshot", { who: "agents", title: "Screenshot", from: undefined, source: "tools" }),
    ]),
  );
  const links: string[] = [];
  const spec = actionsInterface({
    registry,
    open: async (url) => {
      links.push(url);
      return url.includes("fail") ? { ok: false, error: "Nope." } : { ok: true, text: "Hello, Alex" };
    },
  });
  const call = (member: string, args: unknown[] = []) =>
    spec.methods?.[member]?.handler(args, { sender: ":1.9", path: "/dev/dashi/Shell", interface: ACTIONS_INTERFACE, member });
  return { spec, call, links };
}

test("List names the person's actions only; Describe says what one takes", () => {
  const { spec, call } = service();
  expect(spec.name).toBe("dev.dashi.Shell.Actions1");
  expect(call("List")).toEqual([["dashi://script/hello.sh", "Say hello", "run", "Script"]]);
  const described = call("Describe", ["dashi://script/hello.sh"]) as Map<string, Variant>;
  expect(described.get("title")?.value).toBe("Say hello");
  expect(described.get("from")?.value).toBe("Script");
  expect(JSON.parse(String(described.get("arguments")?.value))).toEqual({ type: "object", properties: { name: { type: "string" } }, required: [] });
  // An agent's own tool is not here.
  expect(() => call("Describe", ["dashi://tool/screenshot"])).toThrow(DBusError);
});

test("Run is a link from outside: its arguments go in the address, and a refusal is a D-Bus error", async () => {
  const { call, links } = service();
  expect(await call("Run", ["dashi://script/hello.sh", new Map([["name", new Variant("s", "Alex")]])])).toBe("Hello, Alex");
  expect(links).toEqual(["dashi://script/hello.sh?name=Alex"]);
  await expect(call("Run", ["dashi://nothing/here", new Map()]) as Promise<unknown>).rejects.toThrow(DBusError);
  await expect(call("Run", ["dashi://script/hello.sh", new Map([["name", new Variant("s", "fail")]])]) as Promise<unknown>).rejects.toThrow("Nope.");
});

test("arguments over D-Bus: text, numbers and true or false only", () => {
  expect(
    argsFromVariants(
      new Map<string, Variant>([
        ["a", new Variant("s", "x")],
        ["b", new Variant("x", 3n)],
        ["c", new Variant("b", true)],
        ["d", new Variant("d", 1.5)],
      ]),
    ),
  ).toEqual({
    a: "x",
    b: 3,
    c: true,
    d: 1.5,
  });
  expect(() => argsFromVariants(new Map([["a", new Variant("as", ["x"])]]))).toThrow(DBusError);
  expect(() => argsFromVariants(new Map([["bad-name", new Variant("s", "x")]]))).toThrow(DBusError);
  expect(() => argsFromVariants("nope")).toThrow(DBusError);
});

test("what a command's open reaches: a web page, a dashi:// link, nothing else", async () => {
  const urls: string[] = [];
  const deps = { openUrl: (url: string) => void urls.push(url), openLink: async (url: string) => ok(`link ${url}`) };
  expect(await openTarget("https://example.com", deps)).toEqual(ok("Opened https://example.com"));
  expect(await openTarget("dashi://settings/appearance", deps)).toEqual(ok("link dashi://settings/appearance"));
  expect(await openTarget("file:///etc/passwd", deps)).toMatchObject({ ok: false });
  expect(urls).toEqual(["https://example.com"]);
});
