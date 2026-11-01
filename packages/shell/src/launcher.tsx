/**
 * The launcher (❖Space or a tap of ❖): a search field over installed apps,
 * files (file-search.ts, through LocalSearch), and simple math. ↑/↓ move,
 * Enter opens, Esc or a click outside closes. With nothing typed it offers
 * the apps opened from it last (recents.ts).
 */

import { Image, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { calculate, type Entry, search } from "./entries.ts";
import type { FileHit } from "./file-search.ts";
import { useColors } from "@dashi/ui";

export const LAUNCHER = { width: 620, height: 440, rowHeight: 44 } as const;

/** Rows the panel has room for, apps and files together; files take at most `FILE_ROWS`. */
const ROWS = 7;
const FILE_ROWS = 4;
/** A pause in typing before asking for files, so each keystroke doesn't. */
const FILE_DELAY_MS = 120;

/** A file row: its hit and the icon resolved for it. */
export interface FileRow extends FileHit {
  icon: string;
}

const SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="6" stroke="#000" stroke-width="2" fill="none"/><path d="M13 13l5 5" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>`;

export function Launcher({
  entries,
  recent = [],
  onOpen,
  findFiles,
  onOpenFile,
  onClose,
}: {
  entries: readonly Entry[];
  /** Shown while the field is empty. */
  recent?: readonly Entry[];
  onOpen: (entry: Entry) => void;
  /** Files named like the query; without it the launcher searches apps only. */
  findFiles?: (query: string) => Promise<FileRow[]>;
  onOpenFile?: (file: FileRow) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState<{ query: string; files: FileRow[] }>({ query: "", files: [] });
  const suggesting = query.trim() === "";
  useEffect(() => {
    if (!findFiles || suggesting) return;
    let current = true;
    const timer = setTimeout(() => {
      void findFiles(query).then((files) => {
        // An answer for what was typed before is dropped.
        if (current) setFound({ query, files });
      });
    }, FILE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [findFiles, query, suggesting]);
  const files = !suggesting && found.query === query ? found.files.slice(0, FILE_ROWS) : [];
  const results = suggesting ? recent : search(entries, query, Math.max(ROWS - files.length, ROWS - FILE_ROWS));
  const answer = calculate(query);
  const count = results.length + files.length;
  const pick = (index: number) => {
    const entry = results[index];
    if (entry) return onOpen(entry);
    const file = files[index - results.length];
    if (file) onOpenFile?.(file);
  };

  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center" }}>
      {/* A click anywhere outside the panel closes the launcher. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
      <View
        occlude
        style={{
          width: LAUNCHER.width,
          flexDirection: "column",
          borderRadius: 16,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 18, paddingRight: 18, height: 56 }}>
          <Svg markup={SEARCH} size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            autoFocus
            placeholder={findFiles ? "Search apps and files" : "Search apps"}
            onChangeText={(text) => {
              setQuery(text);
              setSelected(0);
            }}
            onSubmitEditing={() => pick(selected)}
            onKeyPress={(key) => {
              if (key === "Escape") onClose();
              if (key === "ArrowDown") setSelected((index) => Math.min(index + 1, Math.max(count - 1, 0)));
              if (key === "ArrowUp") setSelected((index) => Math.max(index - 1, 0));
            }}
            style={{ flex: 1, fontSize: 22, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
          />
        </View>
        {(answer !== null || count > 0) && (
          <View style={{ flexDirection: "column", borderTopWidth: 1, borderColor: colors.separator, padding: 6 }}>
            {answer !== null && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, height: LAUNCHER.rowHeight, paddingLeft: 12 }}>
                <Text style={{ fontSize: 20, fontWeight: "semibold", color: colors.text }}>= {answer}</Text>
              </View>
            )}
            {suggesting && results.length > 0 && (
              <View style={{ height: 22, paddingLeft: 12, justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>Recent</Text>
              </View>
            )}
            {results.map((entry, index) => (
              <View
                key={entry.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  height: LAUNCHER.rowHeight,
                  paddingLeft: 10,
                  paddingRight: 12,
                  borderRadius: 10,
                  backgroundColor: index === selected ? colors.selection : "#00000000",
                }}
                onPress={() => pick(index)}
              >
                <Image source={entry.icon} style={{ width: 30, height: 30 }} />
                <Text style={{ fontSize: 15, color: index === selected ? "#ffffff" : colors.text }}>{entry.name}</Text>
              </View>
            ))}
            {files.length > 0 && (
              <View style={{ height: 22, paddingLeft: 12, justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>Files</Text>
              </View>
            )}
            {files.map((file, offset) => {
              const index = results.length + offset;
              const chosen = index === selected;
              return (
                <View
                  key={file.url}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    height: LAUNCHER.rowHeight,
                    paddingLeft: 10,
                    paddingRight: 12,
                    borderRadius: 10,
                    backgroundColor: chosen ? colors.selection : "#00000000",
                  }}
                  onPress={() => pick(index)}
                >
                  <Image source={file.icon} style={{ width: 30, height: 30 }} />
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, color: chosen ? "#ffffff" : colors.text }}>
                      {file.name}
                    </Text>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: chosen ? "#ffffffb3" : colors.textMuted }}>
                      {file.folder}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
