import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { type FieldValue, parseTree, toWire, type ViewMessage, type ViewNode } from "../src/index.ts";
import { Action, ActionPanel, Form, type FormValues, useAccount } from "../src/launcher/index.ts";
import { LauncherViews } from "../src/launcher/views.ts";
import { flush } from "./support/time.ts";

const now = {
  set: (fn: () => void) => {
    const handle = setImmediate(fn);
    return () => clearImmediate(handle);
  },
  now: () => 0,
};

/** The last whole tree sent (these tests send no patches they read). */
function lastTree(sent: ViewMessage[]): ViewNode {
  const tree = sent.findLast((message) => message.type === "tree");
  if (tree?.type !== "tree") throw new Error("no tree");
  return tree.root;
}

const find = (node: ViewNode, test: (node: ViewNode) => boolean): ViewNode | undefined =>
  test(node) ? node : node.c.map((child) => find(child, test)).find(Boolean);

function CreateIssue({ sent }: { sent: FormValues[] }) {
  const account = useAccount("github.com");
  const [titleError, setTitleError] = useState<string | undefined>();
  return (
    <Form
      draft
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Issue" onSubmit={(values) => void sent.push(values)} />
          <Action.ConnectAccount title="Connect GitHub…" provider="github.com" />
        </ActionPanel>
      }
    >
      <Form.Dropdown name="repo" title="Repository" value="alexk/dotfiles" info={account.connected ? `As ${account.login}` : "Not connected"}>
        <Form.Dropdown.Item title="alexk/dotfiles" value="alexk/dotfiles" />
        <Form.Dropdown.Item title="alexk/notes" value="alexk/notes" />
      </Form.Dropdown>
      <Form.TextField
        name="title"
        title="Title"
        required
        max={256}
        error={titleError}
        onChange={(value) => setTitleError(value.includes("TODO") ? "Say what is wrong" : undefined)}
      />
      <Form.TextArea name="body" title="Description" />
      <Form.TagPicker name="labels" title="Labels" value={["bug"]}>
        <Form.TagPicker.Item title="bug" value="bug" />
        <Form.TagPicker.Item title="launcher" value="launcher" />
      </Form.TagPicker>
      <Form.Checkbox name="assign" title="Assignee" label="Assign it to me" value={false} />
    </Form>
  );
}

function open(sent: FormValues[]) {
  const out: ViewMessage[] = [];
  const views = new LauncherViews({ issue: () => <CreateIssue sent={sent} /> }, (message) => out.push(message), now);
  views.receive({ type: "open", seq: 1, command: "issue", args: {}, query: "", preferences: {}, accounts: {} });
  return { out, views };
}

describe("a form", () => {
  test("renders to a Form tree the shell accepts: fields by name, options, the submit action", async () => {
    const { out } = open([]);
    await flush();
    const root = lastTree(out);
    expect(root.t).toBe("Form");
    expect(root.p).toEqual({ draft: true });
    expect("error" in parseTree(toWire(root))).toBe(false);
    const title = find(root, (node) => node.t === "TextField");
    expect(title?.p).toEqual({ name: "title", title: "Title", required: true, max: 256 });
    expect(find(root, (node) => node.t === "Dropdown")?.c.map((option) => option.p.value)).toEqual(["alexk/dotfiles", "alexk/notes"]);
    expect(find(root, (node) => node.t === "TagPicker")?.p.value).toEqual(["bug"]);
    expect(find(root, (node) => node.t === "Action" && node.p.kind === "submit")?.p.title).toBe("Create Issue");
    expect(find(root, (node) => node.t === "Action" && node.p.kind === "connect")?.p.target).toBe("github.com");
  });

  test("a change reaches the field's onChange, and the extension's error is sent back", async () => {
    const { out, views } = open([]);
    await flush();
    const title = find(lastTree(out), (node) => node.t === "TextField");
    if (!title) throw new Error("no title field");
    views.receive({ type: "event", seq: 1, on: "change", node: title.i, value: "TODO later" });
    await flush();
    const sentNow = out.at(-1);
    expect(sentNow?.type).toBe("patch");
    expect(JSON.stringify(sentNow)).toContain("Say what is wrong");
  });

  test("submit hands the values to onSubmit", async () => {
    const sent: FormValues[] = [];
    const { out, views } = open(sent);
    await flush();
    const submit = find(lastTree(out), (node) => node.t === "Action" && node.p.kind === "submit");
    if (!submit) throw new Error("no submit");
    const values: Record<string, FieldValue> = { repo: "alexk/notes", title: "The filter forgets", body: "", labels: ["launcher"], assign: true };
    views.receive({ type: "event", seq: 1, on: "submit", node: submit.i, values });
    await flush();
    expect(sent).toEqual([values]);
  });

  test("an account connected reaches useAccount, and the view renders again", async () => {
    const { out, views } = open([]);
    await flush();
    expect(JSON.stringify(lastTree(out))).toContain("Not connected");
    views.receive({ type: "accounts", seq: 1, accounts: { "github.com": { login: "alexk", token: "gho_example" } } });
    await flush();
    expect(JSON.stringify(out.at(-1))).toContain("As alexk");
  });
});
