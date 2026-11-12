import { expect, test } from "bun:test";
import { useConfirm } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import type { NewToken, TokenChange, TokenSummary } from "../src/agents/secrets/types.ts";
import { parseHeaders, parseHosts, type TokenStore, Tokens, tokenDetail } from "../src/settings-app/lib/panes/tokens.tsx";
import { settle, shows, until } from "./support/time.ts";

// Settings › Passwords' tokens on a stand-in for the Metal host: a vault of the test's, presses and typing as the host sends them.

function fakeVault(items: TokenSummary[]) {
  const calls: { saved: NewToken[]; updated: [number, TokenChange][]; removed: number[] } = { saved: [], updated: [], removed: [] };
  const store: TokenStore = {
    list: async () => items,
    save: async (token) => {
      calls.saved.push(token);
      return 9;
    },
    update: async (id, change) => {
      calls.updated.push([id, change]);
    },
    remove: async (id) => {
      calls.removed.push(id);
    },
  };
  return { store, calls };
}

function Harness({ tokens }: { tokens: TokenStore }) {
  const confirm = useConfirm();
  return (
    <View style={{ flex: 1 }}>
      <Tokens tokens={tokens} confirm={confirm} />
      {confirm.sheet}
    </View>
  );
}

/**
 * The view, with every step waiting on the thing itself: a press or typing waits for its node to
 * show, and a test waits for the sheet or the vault's call it expects. A fixed number of turns of
 * the loop was not always enough for the list to load and the view to draw again, under load.
 */
async function mount(tokens: TokenStore) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(<Harness tokens={tokens} />, transport);
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  return {
    shows: (testID: string) => shows(root, testID),
    gone: (testID: string) => until(() => !root.nodeId(testID), `${testID} to go`),
    press: async (testID: string) => emit({ type: "press", nodeId: await shows(root, testID) }),
    type: async (testID: string, value: string) => emit({ type: "change", nodeId: await shows(root, testID), value }),
  };
}

const GITHUB: TokenSummary = { id: 1, name: "github", hosts: ["api.github.com"], headers: ["Authorization: Bearer {}"], lastUsed: null };
const ANTHROPIC: TokenSummary = {
  id: 2,
  name: "anthropic",
  hosts: ["api.anthropic.com"],
  headers: ["x-api-key: {}", "Authorization: Bearer {}"],
  lastUsed: null,
};

test("a token's line says where it goes and what agents hold; a model key says it stays in the vault", () => {
  expect(tokenDetail(GITHUB)).toBe("api.github.com · in Authorization · agents hold dashi:github");
  expect(tokenDetail(ANTHROPIC)).toBe("api.anthropic.com · in x-api-key or Authorization · Key: in your vault. Claude never sees it.");
  expect(parseHeaders("x-api-key: {}, Authorization: Bearer {}")).toEqual(["x-api-key: {}", "Authorization: Bearer {}"]);
  // A comma inside a value stays in it.
  expect(parseHeaders("X-Token: a, {}")).toEqual(["X-Token: a, {}"]);
  expect(parseHosts(" api.github.com,  *.githubusercontent.com uploads.github.com,")).toEqual([
    "api.github.com",
    "*.githubusercontent.com",
    "uploads.github.com",
  ]);
});

test("a model key is added with its host and both of its SDKs' headers filled in", async () => {
  const { store, calls } = fakeVault([]);
  const view = await mount(store);
  await view.shows("tokens-none");
  await view.press("tokens-add-kind:anthropic");
  await view.type("tokens-add-token", "  sk-ant-test  ");
  await view.press("tokens-add-save");
  await until(() => calls.saved.length > 0, "the token to be saved");
  expect(calls.saved).toEqual([
    { name: "anthropic", hosts: ["api.anthropic.com"], headers: ["x-api-key: {}", "Authorization: Bearer {}"], token: "sk-ant-test" },
  ]);
});

test("editing keeps the token unless a new one is typed", async () => {
  const { store, calls } = fakeVault([GITHUB]);
  const view = await mount(store);
  await view.press("token-edit:1");
  await view.shows("tokens-edit");
  await view.type("tokens-edit-hosts", "api.github.com, uploads.github.com");
  await view.press("tokens-edit-save");
  await until(() => calls.updated.length > 0, "the token to be updated");
  expect(calls.updated).toEqual([[1, { hosts: ["api.github.com", "uploads.github.com"], headers: ["Authorization: Bearer {}"] }]]);
});

test("deleting asks on a sheet first, and Cancel keeps it", async () => {
  const { store, calls } = fakeVault([GITHUB]);
  const view = await mount(store);
  await view.press("token-delete:1");
  await view.shows("tokens-delete-sheet");
  await view.press("tokens-delete-sheet:cancel");
  await view.gone("tokens-delete-sheet");
  expect(calls.removed).toEqual([]);
  await view.press("token-delete:1");
  await view.press("tokens-delete-sheet:ok");
  await until(() => calls.removed.length > 0, "the token to be removed");
  expect(calls.removed).toEqual([1]);
});
