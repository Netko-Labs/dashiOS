/**
 * A peek at the selected file (Space, as Quick Look): over the window, the
 * picture itself, the start of a text file, or the file's icon with its kind
 * and size. The arrows go on to the next item (the selection follows),
 * Return opens it in its app, and Space or Esc puts it away.
 */

import { closeSync, openSync, readSync } from "node:fs";
import { Button, RADIUS, SCRIM, SHADOW, SPACE, TYPE, useColors, useDark, useSurface, WEIGHT } from "@dashi/ui";
import { Image, ScrollView, Text, View } from "@mirinjs/metal";
import { useMemo } from "react";
import { categoryOf, type FileItem, kindText, looksLikeText } from "../files/index.ts";
import { useFiles, useFilesState } from "./context.ts";
import { FileIcon } from "./file-icon.tsx";
import { formatSize } from "./format.ts";
import { previewFor } from "./lib/icons.ts";
import type { Step } from "./lib/selection.ts";

const TEXT_BYTES = 16 * 1024;
/** The peek's room: a picture or text this big, an icon this big, the card's content as wide. */
const PEEK = { width: 520, height: 340, iconHeight: 200, icon: 96, preview: 512 } as const;

/** The start of a text file, or null when it isn't text (or can't be read). */
export function textStart(path: string, bytes = TEXT_BYTES): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = new Uint8Array(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    const head = buffer.subarray(0, read);
    if (!looksLikeText(head.subarray(0, 512))) return null;
    return new TextDecoder().decode(head);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function Body({ item }: { item: FileItem }) {
  const colors = useColors();
  const { store } = useFiles();
  const picture = useMemo(() => (item.kind === "file" ? previewFor(item, PEEK.preview, store.env.cache) : null), [item, store.env.cache]);
  const category = categoryOf(item.mime);
  const text = useMemo(
    () => (item.kind === "file" && !picture && (category === "text" || category === "code") ? textStart(item.path) : null),
    [item, picture, category],
  );
  if (picture) return <Image source={picture} resizeMode="contain" style={{ width: PEEK.width, height: PEEK.height }} />;
  if (text !== null)
    return (
      <ScrollView
        testID="peek:text"
        style={{ width: PEEK.width, height: PEEK.height, padding: SPACE.gap, borderRadius: RADIUS.row, backgroundColor: colors.button }}
      >
        <Text style={{ fontSize: TYPE.secondary.size, fontFamily: "monospace", color: colors.text }}>{text}</Text>
      </ScrollView>
    );
  return (
    <View testID="peek:icon" style={{ width: PEEK.width, height: PEEK.iconHeight, alignItems: "center", justifyContent: "center", gap: SPACE.gap }}>
      <FileIcon item={item} size={PEEK.icon} emblems={store.emblems} />
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
        {item.kind === "folder" ? kindText(item) : `${kindText(item)} · ${formatSize(item.size)}`}
      </Text>
    </View>
  );
}

export function Peek({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const surface = useSurface();
  const dark = useDark();
  const { store } = useFiles();
  useFilesState();
  const item = store.selectedItems().at(-1);
  if (!item) return null;
  return (
    <View
      occlude
      testID="peek:scrim"
      onPress={onClose}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: dark ? SCRIM.dark : SCRIM.light,
      }}
    >
      <View
        testID="peek"
        occlude
        focusTrap
        accessibilityRole="dialog"
        onPress={() => {}}
        onWindowKeyDown={(key) => {
          if (key.ctrl || key.alt || key.meta) return;
          if (key.key === "space" || key.key === "escape") onClose();
          else if (key.key === "enter") {
            onClose();
            store.openSelection();
          } else {
            // In a list ← → go on to the item above or below, as ↑ ↓ do.
            const list = store.getSnapshot().view === "list";
            const steps: Partial<Record<string, Step>> = { left: list ? "up" : "left", right: list ? "down" : "right", up: "up", down: "down" };
            const step = steps[key.key];
            if (step) store.move(step);
          }
        }}
        style={{
          flexDirection: "column",
          alignItems: "center",
          gap: SPACE.gap,
          padding: SPACE.page,
          borderRadius: RADIUS.sheet,
          backgroundColor: surface.card,
          borderWidth: SPACE.px,
          borderColor: colors.separator,
          shadow: SHADOW.xl,
        }}
      >
        <View style={{ width: PEEK.width, flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>
              {item.name}
            </Text>
          </View>
          <Button
            label="Open"
            testID="peek:open"
            onPress={() => {
              onClose();
              store.openSelection();
            }}
          />
          <Button label="Done" testID="peek:done" primary onPress={onClose} />
        </View>
        <Body key={item.path} item={item} />
      </View>
    </View>
  );
}
