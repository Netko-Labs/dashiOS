import { expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { parseArgs } from "../apps/dialog/lib/args.ts";
import { CalendarDialog } from "../apps/dialog/lib/calendar.tsx";
import { EntryDialog, PasswordDialog } from "../apps/dialog/lib/entry.tsx";
import type { Answer } from "../apps/dialog/lib/frame.tsx";
import { ListDialog } from "../apps/dialog/lib/list-view.tsx";
import { MessageDialog } from "../apps/dialog/lib/message.tsx";
import { type DialogSpec, specFrom } from "../apps/dialog/lib/spec.ts";
import { settle } from "./support/time.ts";

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

// The dialogs mounted on a stand-in for the Metal host: presses and keys sent as the host would, answers recorded.

function spec<K extends DialogSpec["kind"]>(kind: K, ...argv: string[]): Extract<DialogSpec, { kind: K }> {
  const result = specFrom(parseArgs([`--${kind}`, ...argv]), new Date(2026, 10, 3));
  if (!("spec" in result) || result.spec.kind !== kind) throw new Error(`no ${kind} spec`);
  return result.spec as Extract<DialogSpec, { kind: K }>;
}

async function mount(element: (answer: Answer) => ReactElement) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const answers: [number, string | undefined][] = [];
  const root: NativeRoot = render(
    element((code, output) => answers.push([code, output])),
    transport,
  );
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const press = (testID: string): Promise<void> => emit({ type: "press", nodeId: node(testID) });
  await emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  return { root, answers, emit, node, press };
}

test("a question: Yes, No, Esc, and an extra button", async () => {
  const question = spec("question", "--text=Delete it?", "--extra-button=Later");
  const yes = await mount((answer) => <MessageDialog spec={question} answer={answer} />);
  await yes.press("dialog:ok");
  expect(yes.answers).toEqual([[0, undefined]]);

  const no = await mount((answer) => <MessageDialog spec={question} answer={answer} />);
  await no.press("dialog:cancel");
  await no.emit(windowKey(no.node("dialog:keys"), "escape"));
  expect(no.answers).toEqual([
    [1, undefined],
    [1, undefined],
  ]);

  const later = await mount((answer) => <MessageDialog spec={question} answer={answer} />);
  await later.press("dialog:extra:0");
  expect(later.answers).toEqual([[1, "Later\n"]]);
});

test("Enter presses the default button; --default-cancel makes it No", async () => {
  const plain = await mount((answer) => <MessageDialog spec={spec("question")} answer={answer} />);
  await plain.emit(windowKey(plain.node("dialog:keys"), "enter"));
  expect(plain.answers).toEqual([[0, undefined]]);
  const cautious = await mount((answer) => <MessageDialog spec={spec("question", "--default-cancel")} answer={answer} />);
  await cautious.emit(windowKey(cautious.node("dialog:keys"), "enter"));
  expect(cautious.answers).toEqual([[1, undefined]]);
});

test("info has only OK; --switch leaves only the extra buttons", async () => {
  const info = await mount((answer) => <MessageDialog spec={spec("info")} answer={answer} />);
  expect(info.root.nodeId("dialog:cancel")).toBeUndefined();
  expect(info.root.nodeId("dialog:ok")).toBeDefined();
  const switched = await mount((answer) => <MessageDialog spec={spec("question", "--switch", "--extra-button=One")} answer={answer} />);
  expect(switched.root.nodeId("dialog:ok")).toBeUndefined();
  expect(switched.root.nodeId("dialog:cancel")).toBeUndefined();
  expect(switched.root.nodeId("dialog:extra:0")).toBeDefined();
});

test("an entry prints what was typed", async () => {
  const entry = await mount((answer) => <EntryDialog spec={spec("entry", "--entry-text=start")} answer={answer} />);
  await entry.emit({ type: "change", nodeId: entry.node("dialog:entry"), value: "hello" });
  await entry.press("dialog:ok");
  expect(entry.answers).toEqual([[0, "hello\n"]]);
  const submitted = await mount((answer) => <EntryDialog spec={spec("entry")} answer={answer} />);
  await submitted.emit({ type: "submit", nodeId: submitted.node("dialog:entry"), value: "typed" });
  expect(submitted.answers).toEqual([[0, "typed\n"]]);
});

test("a password with a username prints user|password", async () => {
  const password = await mount((answer) => <PasswordDialog spec={spec("password", "--username")} answer={answer} />);
  await password.emit({ type: "change", nodeId: password.node("dialog:username"), value: "ada" });
  await password.emit({ type: "change", nodeId: password.node("dialog:password"), value: "s3cret" });
  await password.emit({ type: "submit", nodeId: password.node("dialog:password"), value: "s3cret" });
  expect(password.answers).toEqual([[0, "ada|s3cret\n"]]);
});

test("a list prints the chosen row; a checklist its ticked rows", async () => {
  const list = await mount((answer) => <ListDialog spec={spec("list", "--column=Name", "--column=Size", "a", "1", "b", "2")} answer={answer} />);
  await list.press("dialog:list:row:1");
  await list.press("dialog:ok");
  expect(list.answers).toEqual([[0, "b\n"]]);

  const checks = await mount((answer) => (
    <ListDialog spec={spec("list", "--checklist", "--column=", "--column=App", "TRUE", "Steam", "FALSE", "Files", "FALSE", "Notes")} answer={answer} />
  ));
  await checks.press("dialog:list:row:2");
  await checks.press("dialog:ok");
  expect(checks.answers).toEqual([[0, "Steam|Notes\n"]]);

  const nothing = await mount((answer) => <ListDialog spec={spec("list", "--column=Name", "a")} answer={answer} />);
  await nothing.press("dialog:ok");
  expect(nothing.answers).toEqual([[0, undefined]]);
});

test("a calendar prints the day picked, in --date-format", async () => {
  const calendar = await mount((answer) => (
    <CalendarDialog spec={spec("calendar", "--day=3", "--month=11", "--year=2026", "--date-format=%Y-%m-%d")} answer={answer} />
  ));
  await calendar.press("dialog:day:20");
  await calendar.press("dialog:next");
  await calendar.press("dialog:ok");
  expect(calendar.answers).toEqual([[0, "2026-12-20\n"]]);
});
