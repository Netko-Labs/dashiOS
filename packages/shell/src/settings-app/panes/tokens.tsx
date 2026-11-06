/**
 * Settings › Passwords, Tokens (docs/secrets.md, "Tokens that stay home"):
 * API tokens and model keys in the vault, each for the hosts it lists. An
 * agent run through dashi-agent holds a placeholder (`dashi:github`); the
 * shell's token proxy puts the token in only on the way to those hosts. A
 * token typed here goes to dashi-secretd and is never shown again; deleting
 * one asks first, on a confirm sheet.
 */

import { type Confirm, useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useCallback, useEffect, useState } from "react";
import type { TokenSummary, VaultTokens } from "../../agents/secrets/vault.ts";
import { MODEL_KEYS, modelKey } from "../../agents/tokens/model-keys.ts";
import { DEFAULT_HEADER, placeholder } from "../../agents/tokens/swap.ts";
import { Button, Caption, Choices, Group, Note, Row, useSurface } from "../ui.tsx";
import { Failure, MiniButton, VAULT_TROUBLE } from "./parts.tsx";

export type TokenStore = Pick<VaultTokens, "list" | "save" | "update" | "remove">;

/** "api.github.com, *.githubusercontent.com" as a list (commas or spaces between). */
export function parseHosts(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((host) => host.trim())
    .filter((host) => host !== "");
}

/** A token's line under its name: what it is for, and what agents hold instead. */
export function tokenDetail(token: Pick<TokenSummary, "name" | "hosts">): string {
  const key = modelKey(token.name);
  const hosts = token.hosts.join(", ");
  return key ? `${hosts} · Key: in your vault. ${key.agent} never sees it.` : `${hosts} · agents hold ${placeholder(token.name)}`;
}

type Kind = "other" | (typeof MODEL_KEYS)[number]["name"];

interface Form {
  kind: Kind;
  name: string;
  hosts: string;
  header: string;
  token: string;
}

const EMPTY: Form = { kind: "other", name: "", hosts: "", header: DEFAULT_HEADER, token: "" };

/** The form for `kind`: a model key fills in its name, host and header. */
export function formFor(kind: Kind, current: Form): Form {
  const key = modelKey(kind);
  return key ? { ...current, kind, name: key.name, hosts: key.hosts.join(", "), header: key.header } : { ...EMPTY, kind, token: current.token };
}

function Field({
  testID,
  value,
  placeholder: hint,
  secure,
  onChange,
}: {
  testID: string;
  value: string;
  placeholder: string;
  secure?: boolean;
  onChange: (text: string) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ width: 240 }}>
      <TextInput
        testID={testID}
        value={value}
        placeholder={hint}
        secureTextEntry={secure === true}
        onChangeText={onChange}
        style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
      />
    </View>
  );
}

/** Adds a token, or (with `editing`) changes one: its hosts, its header, and its token if a new one is typed. */
function TokenForm({ tokens, editing, onDone }: { tokens: TokenStore; editing: TokenSummary | null; onDone: () => void }) {
  const [form, setForm] = useState<Form>(
    editing ? { kind: "other", name: editing.name, hosts: editing.hosts.join(", "), header: editing.header, token: "" } : EMPTY,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: "name" | "hosts" | "header" | "token") => (text: string) => setForm((current) => ({ ...current, [key]: text }));
  const finish = (work: Promise<unknown>): void => {
    void work
      .then(() => {
        setForm(EMPTY);
        setProblem(null);
        onDone();
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  };
  const hosts = parseHosts(form.hosts);
  const token = form.token.trim();
  const save = (): void =>
    finish(
      editing
        ? tokens.update(editing.id, { hosts, header: form.header.trim(), ...(token ? { token } : {}) })
        : tokens.save({ name: form.name.trim(), hosts, header: form.header.trim(), token }),
    );
  const id = editing ? "tokens-edit" : "tokens-add";
  return (
    <Group testID={id}>
      {editing ? (
        <Row label={`Change ${editing.name}`} detail={`Agents hold ${placeholder(editing.name)}; its name stays.`} />
      ) : (
        <>
          <Row label="Kind">
            <Choices
              testID={`${id}-kind`}
              value={form.kind}
              options={[...MODEL_KEYS.map((key) => ({ value: key.name as Kind, label: key.label })), { value: "other" as Kind, label: "Other" }]}
              onChange={(kind) => setForm((current) => formFor(kind, current))}
            />
          </Row>
          <Row label="Name" detail={form.name.trim() ? `Agents hold ${placeholder(form.name.trim().toLowerCase())}` : "What agents hold it by"}>
            <Field testID={`${id}-name`} value={form.name} placeholder="github" onChange={set("name")} />
          </Row>
        </>
      )}
      <Row label="Hosts" detail="Only these get it; *.example.com for every host under example.com">
        <Field testID={`${id}-hosts`} value={form.hosts} placeholder="api.github.com" onChange={set("hosts")} />
      </Row>
      <Row label="Header" detail="Where the token goes: {} is the token">
        <Field testID={`${id}-header`} value={form.header} placeholder={DEFAULT_HEADER} onChange={set("header")} />
      </Row>
      <Row label="Token" detail={problem ?? (editing ? "Leave empty to keep the one saved" : "Saved in your vault; never shown again")}>
        <Field testID={`${id}-token`} value={form.token} placeholder={editing ? "New token" : "Token"} secure onChange={set("token")} />
      </Row>
      <Row label="">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {editing && <Button testID={`${id}-cancel`} label="Cancel" onPress={onDone} />}
          <Button
            testID={`${id}-save`}
            label={editing ? "Save Changes" : "Save Token"}
            primary
            disabled={hosts.length === 0 || !form.header.trim() || (!editing && (!form.name.trim() || !token))}
            onPress={save}
          />
        </View>
      </Row>
    </Group>
  );
}

export function Tokens({ tokens, confirm }: { tokens: TokenStore; confirm: Confirm }) {
  const colors = useColors();
  // Null until the vault answers; a failed read says so instead of claiming there are none.
  const [list, setList] = useState<TokenSummary[] | null>(null);
  const [editing, setEditing] = useState<TokenSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void tokens
      .list()
      .then((items) => setList(items))
      .catch((error: unknown) => {
        console.error("dashi-shell: Tokens:", error instanceof Error ? error.message : error);
        setFailure(`Your tokens couldn't be read. ${VAULT_TROUBLE}`);
      });
  }, [tokens]);
  useEffect(() => refresh(), [refresh]);
  const remove = (token: TokenSummary): void =>
    confirm.ask({
      title: `Delete the token “${token.name}”?`,
      message: `Agents holding ${placeholder(token.name)} can't reach ${token.hosts.join(", ")} with it any more. You can't undo this.`,
      confirmLabel: "Delete",
      danger: true,
      testID: "tokens-delete-sheet",
      onConfirm: () => {
        setFailure(null);
        if (editing?.id === token.id) setEditing(null);
        void tokens
          .remove(token.id)
          .catch((error: unknown) => {
            console.error("dashi-shell: Tokens:", error instanceof Error ? error.message : error);
            setFailure(`“${token.name}” wasn't deleted. ${VAULT_TROUBLE}`);
          })
          .finally(refresh);
      },
    });
  return (
    <>
      <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Tokens</Text>
      <Group testID="tokens-list">
        {list === null ? (
          <Note testID="tokens-loading">{failure ? "Tokens can't be shown right now." : "Looking…"}</Note>
        ) : list.length === 0 ? (
          <Note testID="tokens-none">No tokens. Add an API token or a model key below: agents get a placeholder, never the token.</Note>
        ) : (
          list.map((token) => (
            <Row key={token.id} label={modelKey(token.name)?.label ?? token.name} detail={tokenDetail(token)} testID={`token:${token.id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MiniButton testID={`token-edit:${token.id}`} label="Edit…" onPress={() => setEditing(token)} />
                <MiniButton testID={`token-delete:${token.id}`} label="Delete…" tone="critical" onPress={() => remove(token)} />
              </View>
            </Row>
          ))
        )}
      </Group>
      {failure && <Failure testID="tokens-failure">{failure}</Failure>}
      <TokenForm
        key={editing?.id ?? "new"}
        tokens={tokens}
        editing={editing}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
      <Caption>
        For agents run with dashi-agent: they hold the placeholder, and Dashi puts the token in only for requests to its hosts. Anywhere else the placeholder is
        worthless.
      </Caption>
    </>
  );
}
