import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { applyPatch, isRefusal, toWire, type ViewMessage, type ViewNode } from "../src/index.ts";
import { Action, ActionPanel, Detail, List, useNavigation, usePreferences } from "../src/launcher/index.ts";
import { LauncherViews } from "../src/launcher/views.ts";
import { flush } from "./support/time.ts";

/** The shell's side, as far as these tests go: the tree it holds, kept up to date by the messages. */
class Shell {
  readonly sent: ViewMessage[] = [];
  readonly stack: ViewNode[] = [];
  receive = (message: ViewMessage): void => {
    this.sent.push(message);
    if (message.type === "tree") this.stack[Math.max(0, this.stack.length - 1)] = message.root;
    if (message.type === "push") this.stack.push(message.root);
    if (message.type === "pop") this.stack.pop();
    if (message.type === "patch") {
      const top = this.stack.at(-1);
      if (!top) throw new Error("a patch before a tree");
      const next = applyPatch(top, message.ops);
      if (isRefusal(next)) throw new Error(next.error);
      this.stack[this.stack.length - 1] = next;
    }
  };
  get top(): Record<string, unknown> {
    const node = this.stack.at(-1);
    if (!node) throw new Error("nothing shown");
    return toWire(node);
  }
}

/** Timers that run at once: the view sends on the next turn of the loop. */
const now = {
  set: (fn: () => void) => {
    const handle = setImmediate(fn);
    return () => clearImmediate(handle);
  },
  now: () => 0,
};

function Counter() {
  const [count, setCount] = useState(0);
  const { push } = useNavigation();
  const { greeting } = usePreferences<{ greeting: string }>();
  return (
    <List filter="launcher" placeholder="Filter">
      <List.Section title={`${greeting} ${count}`}>
        <List.Item
          id="bump"
          title="Bump"
          accessories={[{ tag: `${count}`, tone: "moss" }]}
          actions={
            <ActionPanel>
              <Action title="Add one" onAction={() => setCount((n) => n + 1)} />
              <Action.Push title="Show details" target={<Detail markdown={`# ${count}`} />} />
              <Action.Copy title="Copy" content="bump" />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="More">
        {Array.from({ length: 30 }, (_, at) => (
          <List.Item key={at} id={`row${at}`} title={`Row ${at}`} subtitle="Stays as it is" />
        ))}
      </List.Section>
    </List>
  );
}

function open(views: LauncherViews, seq = 1): void {
  views.receive({ type: "open", seq, command: "counter", args: {}, query: "", preferences: { greeting: "Hi" } });
}

const actionId = (shell: Shell, title: string): string => {
  const find = (node: Record<string, unknown>): string | undefined => {
    const props = node.p as Record<string, unknown> | undefined;
    if (node.t === "Action" && props?.title === title) return node.i as string;
    for (const child of (node.c as Record<string, unknown>[] | undefined) ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const found = find(shell.top);
  if (!found) throw new Error(`no action “${title}”`);
  return found;
};

describe("the reconciler", () => {
  test("a view renders to a tree: the item keeps the extension's id, words go in props", async () => {
    const shell = new Shell();
    const views = new LauncherViews({ counter: Counter }, shell.receive, now);
    open(views);
    await flush();
    expect(shell.sent[0]?.type).toBe("tree");
    const section = (shell.top.c as Record<string, unknown>[])[0];
    expect(section?.p).toEqual({ title: "Hi 0" });
    const row = (section?.c as Record<string, unknown>[])[0];
    expect(row?.i).toBe("k:bump");
    expect(row?.p).toEqual({ title: "Bump" });
  });

  test("an action runs the extension's callback, and only what changed is sent", async () => {
    const shell = new Shell();
    const views = new LauncherViews({ counter: Counter }, shell.receive, now);
    open(views);
    await flush();
    views.receive({ type: "event", seq: 1, on: "action", node: actionId(shell, "Add one") });
    await flush();
    expect(shell.sent.at(-1)?.type).toBe("patch");
    expect(JSON.stringify(shell.top)).toContain('"Hi 1"');
  });

  test("a preference changed renders the view again", async () => {
    const shell = new Shell();
    const views = new LauncherViews({ counter: Counter }, shell.receive, now);
    open(views);
    await flush();
    views.receive({ type: "prefs", seq: 1, preferences: { greeting: "Hello" } });
    await flush();
    expect(JSON.stringify(shell.top)).toContain('"Hello 0"');
  });

  test("push shows a view over it; Esc's pop brings back the one under", async () => {
    const shell = new Shell();
    const views = new LauncherViews({ counter: Counter }, shell.receive, now);
    open(views);
    await flush();
    views.receive({ type: "event", seq: 1, on: "action", node: actionId(shell, "Show details") });
    await flush();
    expect(shell.sent.at(-1)?.type).toBe("push");
    expect(shell.top.t).toBe("Detail");
    shell.stack.pop();
    views.receive({ type: "event", seq: 1, on: "pop" });
    await flush();
    expect(shell.top.t).toBe("List");
  });

  test("a tree the shell would refuse is never sent: the view says why", async () => {
    const problems: string[] = [];
    const shell = new Shell();
    function Bad() {
      return (
        <List>
          <List.Item title="" />
        </List>
      );
    }
    const { ViewRoot } = await import("../src/launcher/lib/view-root.ts");
    new ViewRoot(<Bad />, { tree: (root) => shell.receive({ type: "tree", seq: 1, root }), patch: () => {} }, now, (problem) => problems.push(problem));
    await flush();
    expect(problems[0]).toContain("title is empty");
    expect(JSON.stringify(shell.top)).toContain("This view can't be shown");
  });

  test("words over an element's limit are cut with an ellipsis, not the view refused", async () => {
    const shell = new Shell();
    const long = "A pull request whose title goes on and on well past what the launcher's rows can hold in one line";
    function Long() {
      return (
        <List>
          <List.Item
            title={long}
            actions={
              <ActionPanel title={long}>
                <Action title="Open" />
              </ActionPanel>
            }
          />
        </List>
      );
    }
    const { ViewRoot } = await import("../src/launcher/lib/view-root.ts");
    new ViewRoot(<Long />, { tree: (root) => shell.receive({ type: "tree", seq: 1, root }), patch: () => {} }, now, () => {});
    await flush();
    const text = JSON.stringify(shell.top);
    expect(text).not.toContain("This view can't be shown");
    expect(text).toContain("the launcher's rows can hold in one line");
    expect(text).toContain("the launcher's rows ca…");
  });

  test("close unmounts every view of the command; events after it are dropped", async () => {
    const shell = new Shell();
    const views = new LauncherViews({ counter: Counter }, shell.receive, now);
    open(views);
    await flush();
    const id = actionId(shell, "Add one");
    views.receive({ type: "event", seq: 1, on: "close" });
    const count = shell.sent.length;
    views.receive({ type: "event", seq: 1, on: "action", node: id });
    await flush();
    expect(shell.sent.length).toBe(count);
  });
});
