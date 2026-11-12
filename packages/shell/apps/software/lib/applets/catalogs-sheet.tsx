/**
 * Catalogs…, from the Menu bar applets' toolbar: the catalogs applets come
 * from, Dashi's first and built in, each added one with Remove…, and Add
 * Catalog…: a name, the index's address and the catalog's public key. The
 * index must be there and signed with that key before it is added; when it
 * isn't, the sheet says why in plain words. Removing one keeps its applets
 * installed, with no updates.
 */

import { AlertSheet, Button, Group, Row, Sheet, TextField, useColors, WARNING } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useRef, useState } from "react";
import type { CatalogLoad, CatalogSource } from "../../../../src/shared/applet-store/index.ts";
import { useServices } from "../services.ts";
import { useAppletState } from "./rows.tsx";

/** The list and the Add a Catalog form are one sheet, so they keep one width. */
const SHEET_WIDTH = 480;

/** What a catalog's row says under its name: built in, how many applets, or why it isn't listing any. */
export function catalogDetail(source: CatalogSource, load: CatalogLoad | undefined): string {
  const where = source.url.replace(/^https:\/\//, "").replace(/^file:\/\//, "");
  const state = (() => {
    if (source.key === null) return "not set up in this Dashi yet";
    if (!load) return where;
    switch (load.problem) {
      case "offline":
        return "can’t be reached right now";
      case "unsigned":
        return "isn’t signed with its key";
      case "invalid":
      case "other":
        return "has no applet catalog";
      case "no-key":
        return "not set up in this Dashi yet";
      case null: {
        const count = load.index?.applets.length ?? 0;
        return `${count} ${count === 1 ? "applet" : "applets"}${load.stale ? " · saved copy" : ""}`;
      }
    }
  })();
  if (source.builtIn) return `Built in · ${state}`;
  return state === where ? where : `${state} · ${where}`;
}

/** A label 4 over its own field, and the sheet's gap away from the field above. */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 4 }}>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      {children}
    </View>
  );
}

function AddCatalog({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const { applets } = useServices();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A check still running when the sheet is left is not answered.
  const attempt = useRef(0);
  const leave = (): void => {
    attempt.current += 1;
    onDone();
  };
  const ready = name.trim() !== "" && url.trim() !== "" && key.trim() !== "" && !busy;
  const submit = (): void => {
    if (!ready) return;
    const mine = ++attempt.current;
    setBusy(true);
    setError(null);
    void applets.addCatalog({ name, url, key }).then((failed) => {
      if (attempt.current !== mine) return;
      setBusy(false);
      if (failed === null) onDone();
      else setError(failed);
    });
  };
  const escape = (pressed: string): void => {
    if (pressed === "Escape") leave();
  };
  return (
    <Sheet testID="add-catalog" width={SHEET_WIDTH} onCancel={leave}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Add a Catalog</Text>
      <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textMuted }}>
        Applets from it are checked as Dashi’s are, but nobody at Dashi reviews them. Add only catalogs you trust.
      </Text>
      <Labeled label="Name">
        <TextField testID="add-catalog:name" value={name} placeholder="Team Applets" autoFocus onChangeText={setName} onSubmit={submit} onKeyPress={escape} />
      </Labeled>
      <Labeled label="Index address">
        <TextField
          testID="add-catalog:url"
          value={url}
          placeholder="https://example.com/applets/index.json"
          onChangeText={setUrl}
          onSubmit={submit}
          onKeyPress={escape}
        />
      </Labeled>
      <Labeled label="Public key">
        <TextField
          testID="add-catalog:key"
          value={key}
          placeholder="RWQ… (from the catalog’s .pub file)"
          onChangeText={setKey}
          onSubmit={submit}
          onKeyPress={escape}
        />
      </Labeled>
      {error !== null && (
        <View testID="add-catalog:error" style={{ paddingTop: 2 }}>
          <Text style={{ fontSize: 12, lineHeight: 17, color: colors.ume }}>{error}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="add-catalog:cancel" onPress={leave} />
        <Button label={busy ? "Checking…" : "Add Catalog"} testID="add-catalog:add" primary disabled={!ready} onPress={submit} />
      </View>
    </Sheet>
  );
}

function RemoveCatalog({ source, onDone }: { source: CatalogSource; onDone: () => void }) {
  const { applets } = useServices();
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertSheet
      testID="remove-catalog"
      width={420}
      question={`Remove “${source.name}”?`}
      message={error ?? "Its applets leave the list. The ones you installed from it stay, but they won’t get updates any more."}
      glyph={WARNING}
      tone="warning"
      buttons={[
        { label: "Cancel", testID: "remove-catalog:cancel", onPress: onDone, cancel: true },
        {
          label: "Remove",
          testID: "remove-catalog:confirm",
          kind: "danger",
          onPress: () => {
            const failed = applets.removeCatalog(source.url);
            if (failed === null) onDone();
            else setError(failed);
          },
        },
      ]}
    />
  );
}

/** The catalogs sheet; `onClose` when it is done. */
export function CatalogsSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const { applets } = useServices();
  const state = useAppletState();
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "add" } | { kind: "remove"; source: CatalogSource }>({ kind: "list" });
  if (mode.kind === "add") return <AddCatalog onDone={() => setMode({ kind: "list" })} />;
  if (mode.kind === "remove") return <RemoveCatalog source={mode.source} onDone={() => setMode({ kind: "list" })} />;
  const sources = applets.sources();
  return (
    <Sheet testID="catalogs" width={SHEET_WIDTH} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Catalogs</Text>
      <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textMuted }}>
        Menu bar applets come from these catalogs. Dashi checks each one’s signature before it lists anything from it.
      </Text>
      <Group testID="catalogs:list">
        {sources.map((source) => (
          <Row
            key={source.url}
            testID={`catalog:${source.name}`}
            label={source.name}
            detail={catalogDetail(
              source,
              state.catalogs.find((load) => load.source.url === source.url),
            )}
          >
            {!source.builtIn && <Button label="Remove…" testID={`catalog:${source.name}:remove`} onPress={() => setMode({ kind: "remove", source })} />}
          </Row>
        ))}
      </Group>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <Button label="Add Catalog…" testID="catalogs:add" onPress={() => setMode({ kind: "add" })} />
        </View>
        <Button label="Done" testID="catalogs:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}
