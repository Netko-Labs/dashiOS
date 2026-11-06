import { expect, test } from "bun:test";
import {
  AppletsClient,
  argSchema,
  checkArgs,
  defineApplet,
  type Manifest,
  manifestJson,
  parseAppletMessage,
  parseAppletShellMessage,
  parseManifest,
  type SocketHandlers,
  wireMessage,
} from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

const noFiles = (): null => null;
const line = (value: unknown): string => JSON.stringify(value);

const COMMANDS = [
  { id: "now", title: "Weather now", keywords: ["temperature"], mode: "instant" },
  { id: "city", title: "Weather in a city", mode: "pick", args: [{ name: "units", type: "string", title: "Units" }] },
  { id: "glance", title: "Weather at a glance", mode: "view" },
];

function manifest(extra: Record<string, unknown> = {}): Manifest {
  const parsed = parseManifest({ ...ASUS, commands: COMMANDS, ...extra });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

test("applet.json's commands: parsed, defaults filled in, and written back", () => {
  const parsed = manifest();
  expect(parsed.commands).toEqual([
    { id: "now", title: "Weather now", keywords: ["temperature"], args: [], mode: "instant" },
    { id: "city", title: "Weather in a city", keywords: [], args: [{ name: "units", type: "string", title: "Units", required: false }], mode: "pick" },
    { id: "glance", title: "Weather at a glance", keywords: [], args: [], mode: "view" },
  ]);
  expect(parseManifest(manifestJson(parsed))).toEqual(parsed);
  // None is the default, and an applet without any writes none.
  const plain = parseManifest(ASUS);
  if ("error" in plain) throw new Error(plain.error);
  expect(plain.commands).toEqual([]);
  expect(manifestJson(plain)).not.toHaveProperty("commands");
});

test("commands that can't be refused with a reason", () => {
  const refused = (commands: unknown) => parseManifest({ ...ASUS, commands });
  expect(refused([{ id: "a", title: "A", mode: "later" }])).toMatchObject({ error: expect.stringContaining("mode") });
  expect(refused([{ id: "a b", title: "A", mode: "instant" }])).toMatchObject({ error: expect.stringContaining("id") });
  expect(refused([{ id: "a", title: "x".repeat(61), mode: "instant" }])).toMatchObject({ error: expect.stringContaining("60") });
  expect(refused([{ id: "a", title: "A", mode: "instant", run: "rm -rf" }])).toMatchObject({ error: expect.stringContaining("unknown field") });
  expect(
    refused([
      { id: "a", title: "A", mode: "instant" },
      { id: "a", title: "B", mode: "pick" },
    ]),
  ).toMatchObject({ error: expect.stringContaining("twice") });
  expect(refused([{ id: "a", title: "A", mode: "instant", args: [{ name: "City", type: "string" }] }])).toMatchObject({
    error: expect.stringContaining("name"),
  });
  expect(refused(Array.from({ length: 17 }, (_, at) => ({ id: `c${at}`, title: "C", mode: "instant" })))).toMatchObject({
    error: expect.stringContaining("16"),
  });
});

test("a command's arguments: as JSON Schema, and checked as the launcher does", () => {
  const command = {
    args: [
      { name: "city", type: "string" as const, title: "City", required: true },
      { name: "days", type: "number" as const, required: false },
    ],
  };
  expect(argSchema(command)).toEqual({ properties: { city: { type: "string", description: "City" }, days: { type: "number" } }, required: ["city"] });
  expect(checkArgs(command, { city: "Lisbon", days: 3 })).toEqual({ values: { city: "Lisbon", days: 3 } });
  expect(checkArgs(command, {})).toEqual({ error: "It needs “City”." });
  expect(checkArgs(command, { city: 3 })).toEqual({ error: "“City” must be text." });
  expect(checkArgs(command, { city: "Lisbon", when: "now" })).toEqual({ error: "It takes no “when”." });
});

test("version 3's messages need a version 3 connection, and are checked", () => {
  expect(parseAppletMessage(line({ type: "result", seq: 1, text: "21°" }), noFiles, 2)).toMatchObject({ error: expect.stringContaining("protocol 3") });
  expect(parseAppletMessage(line({ type: "result", seq: 1, text: "21°" }), noFiles, 3)).toEqual({ type: "result", seq: 1, result: { text: "21°" } });
  expect(parseAppletMessage(line({ type: "result", seq: 2, copy: "Lisbon: 19°" }), noFiles, 3)).toEqual({
    type: "result",
    seq: 2,
    result: { copy: "Lisbon: 19°" },
  });
  expect(parseAppletMessage(line({ type: "result", seq: 3, open: "https://example.com/forecast" }), noFiles, 3)).toMatchObject({
    result: { open: "https://example.com/forecast" },
  });
  expect(parseAppletMessage(line({ type: "result", seq: 3, open: "file:///etc/passwd" }), noFiles, 3)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "result", seq: 3, text: "a", copy: "b" }), noFiles, 3)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "result", seq: 0, text: "a" }), noFiles, 3)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "items", seq: 4, rows: [{ id: "lisbon", title: "Lisbon, now 19°", detail: "clear" }] }), noFiles, 3)).toEqual({
    type: "items",
    seq: 4,
    rows: [{ id: "lisbon", title: "Lisbon, now 19°", detail: "clear" }],
  });
  const many = Array.from({ length: 21 }, (_, at) => ({ id: `r${at}`, title: "Row" }));
  expect(parseAppletMessage(line({ type: "items", seq: 4, rows: many }), noFiles, 3)).toMatchObject({ error: expect.stringContaining("20") });
  expect(parseAppletMessage(line({ type: "view", seq: 5, height: 160 }), noFiles, 3)).toEqual({ type: "view", seq: 5, height: 160 });
  expect(parseAppletMessage(line({ type: "view", seq: 5, height: 900 }), noFiles, 3)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "dismiss", seq: 5 }), noFiles, 3)).toEqual({ type: "dismiss-view", seq: 5 });
  // A popover's dismiss is as it was.
  expect(parseAppletMessage(line({ type: "dismiss", id: "w" }), noFiles, 3)).toEqual({ type: "dismiss", id: "w" });
});

test("the shell's version 3 messages, read on the applet's side and written for the wire", () => {
  expect(parseAppletShellMessage(line({ type: "run", seq: 7, command: "city", args: { units: "C" }, query: "lis" }))).toEqual({
    type: "run",
    seq: 7,
    command: "city",
    args: { units: "C" },
    query: "lis",
  });
  expect(parseAppletShellMessage(line({ type: "run", seq: 7, command: "city", args: { units: { nested: true } } }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "dismiss", seq: 9 }))).toEqual({ type: "dismiss-view", seq: 9 });
  expect(wireMessage({ type: "dismiss-view", seq: 9 })).toEqual({ type: "dismiss", seq: 9 });
});

function fakeShell() {
  const sent: Array<Record<string, unknown>> = [];
  let handlers: SocketHandlers | null = null;
  const connect = (_path: string, given: SocketHandlers): void => {
    handlers = given;
    given.open({
      write: (data) => {
        for (const part of new TextDecoder().decode(data).split("\n")) if (part) sent.push(JSON.parse(part));
        return data.byteLength;
      },
      end: () => {},
    });
  };
  const reply = (message: unknown): void => handlers?.data(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  return { sent, connect, reply };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("defineApplet answers the launcher's commands: a line, rows, a chosen row, and a view asked for", async () => {
  const shell = fakeShell();
  const given = manifest();
  const client = new AppletsClient({ path: "/run/x.sock", manifest: given, connect: shell.connect, exists: () => true, later: () => () => {} });
  const applet = defineApplet({
    client,
    manifest: given,
    initial: { celsius: 21 },
    label: (state) => `${state.celsius}°`,
    commands: {
      now: { run: (_args, handle) => `${handle.state.celsius}° and clear` },
      city: {
        items: (query) => [{ id: "lisbon", title: `Lisbon for “${query}”` }],
        choose: (item) => ({ copy: `chose ${item}` }),
      },
      glance: { view: { height: 160, component: () => null } },
    },
  });
  // Before the shell says it speaks 3, nothing is answered.
  shell.reply({ type: "run", seq: 1, command: "now", args: {} });
  await settle();
  expect(shell.sent.filter((message) => message.type === "result")).toEqual([]);
  shell.reply({ type: "welcome", protocol: 3 });
  shell.reply({ type: "run", seq: 2, command: "now", args: {} });
  shell.reply({ type: "run", seq: 3, command: "city", args: {}, query: "lis" });
  shell.reply({ type: "run", seq: 4, command: "city", args: {}, item: "lisbon" });
  shell.reply({ type: "run", seq: 5, command: "glance", args: {} });
  shell.reply({ type: "run", seq: 6, command: "nope", args: {} });
  await settle();
  const answers = shell.sent.filter((message) => typeof message.seq === "number");
  expect(answers).toEqual([
    { type: "view", seq: 5, height: 160 },
    { type: "result", seq: 6, error: "ASUS Control has no command “nope”." },
    { type: "result", seq: 2, text: "21° and clear" },
    { type: "items", seq: 3, rows: [{ id: "lisbon", title: "Lisbon for “lis”" }] },
    { type: "result", seq: 4, copy: "chose lisbon" },
  ]);
  applet.stop();
});
