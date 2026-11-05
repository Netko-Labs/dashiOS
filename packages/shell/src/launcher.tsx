/**
 * The launcher (❖Space or a tap of ❖): a search field over installed apps,
 * Settings panes, files (through LocalSearch), and sums. What it lists is
 * launcher/rows.ts; how the selection moves is launcher/selection.ts.
 *
 * - The selection is a row's id: files that land late never put another row
 *   under it, and Enter acts on the row highlighted when it is pressed.
 * - ↑ ↓ (and ⌃P ⌃N) wrap; Page Up and Page Down, Home and End (launcher/keys.ts);
 *   the pointer over a row selects it. Esc clears the field, then closes.
 * - A sum is the first row: Enter copies it, and it says so in place.
 * - Nothing found offers Did you mean, Search files, and Find in Software.
 * - With nothing typed: Recent, else a few things to try, then All apps.
 */

import { SEARCH, useColors } from "@dashi/ui";
import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { iconPath } from "./apps.ts";
import { useClockPrefs, usesHour24 } from "./clock.ts";
import type { Entry } from "./entries.ts";
import { ReservedRows, ResultRow, SectionHead } from "./launcher/row-view.tsx";
import { buildSections, FILE_ROWS, type FileRow, filesStateFor, placeholderFor, type Row, selectable } from "./launcher/rows.ts";
import { keepInView, type Move, moveSelection, resolveSelection } from "./launcher/selection.ts";

export type { FileRow } from "./launcher/rows.ts";

/** The surface, and the measures of the panel on it (docs/design.html LA-1, TY-1, RA-1: the launcher's row). */
export const LAUNCHER = { width: 620, height: 520, field: 48, fieldText: 17, radius: 12, padding: 5 } as const;

/** A pause in typing before asking for files, so each keystroke doesn't. */
export const FILE_DELAY_MS = 120;
/** Rows of All apps drawn at once; the selection scrolls them. */
const ALL_APPS_ROWS = 8;

/** Files for the launcher: whether it can look now (the placeholder says), and the looking; null when it couldn't. */
export interface LauncherFiles {
  isAvailable(): boolean;
  find(query: string): Promise<FileRow[] | null>;
}

/** The compositor's keys for the launcher while it is open (launcher/keys.ts). */
export interface LauncherKeySource {
  subscribe(listener: (move: Move) => void): () => void;
}

export interface LauncherProps {
  entries: readonly Entry[];
  /** Shown while the field is empty. */
  recent?: readonly Entry[];
  /** Start an entry. False when it could not be: the launcher stays open and says so. */
  onOpen: (entry: Entry) => boolean;
  /** Files named like the query; without it the launcher looks through apps and settings only. */
  files?: LauncherFiles;
  onOpenFile?: (file: FileRow) => void;
  /** Look for `query` in Files (the folder walk works with LocalSearch off too). */
  onSearchFiles?: (query: string) => void;
  onFindSoftware?: (query: string) => void;
  /** Put the answer on the clipboard; whether it worked. */
  copy?: (text: string) => Promise<boolean>;
  keys?: LauncherKeySource;
  onClose: () => void;
}

const ICONS = { calculator: iconPath("calculator"), files: iconPath("files"), software: iconPath("software") };

export function Launcher({ entries, recent = [], onOpen, files, onOpenFile, onSearchFiles, onFindSoftware, copy, keys, onClose }: LauncherProps) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [held, setHeld] = useState<string | null>(null);
  const [allApps, setAllApps] = useState(false);
  const [found, setFound] = useState<{ query: string; files: FileRow[] | null } | null>(null);
  const [filesOff, setFilesOff] = useState(() => files !== undefined && !files.isAvailable());
  // How many file rows the last answer had: that many slots are held while the next one comes.
  const [lastFileCount, setLastFileCount] = useState(0);
  const [copied, setCopied] = useState<{ query: string; ok: boolean } | null>(null);
  const [failed, setFailed] = useState<Entry | null>(null);
  const offset = useRef(0);

  const text = query.trim();
  const filesState = filesStateFor({ query, offered: files !== undefined, off: filesOff, answer: found, lastCount: lastFileCount });
  const waiting = filesState.kind === "waiting";

  useEffect(() => {
    if (!files || !waiting) return;
    let current = true;
    const timer = setTimeout(() => {
      void files.find(text).then((hits) => {
        // An answer for what was typed before is dropped.
        if (!current) return;
        setFound({ query: text, files: hits });
        if (hits === null) setFilesOff(true);
        else setLastFileCount(Math.min(hits.length, FILE_ROWS));
      });
    }, FILE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [files, waiting, text]);

  // Answers in the Region's numbers and the person's clock (answers/).
  const prefs = useClockPrefs();
  const answers = { locale: prefs.locale, hour24: usesHour24(prefs) };
  const sections = buildSections({ query, entries, recent, files: filesState, allApps, copied, failed, icons: ICONS, answers });
  const rows = selectable(sections);
  const ids = rows.map((row) => row.id);
  const selected = resolveSelection(ids, held);
  const latest = useRef(ids);
  latest.current = ids;

  const move = (how: Move) => setHeld((now) => moveSelection(latest.current, now, how));
  // The compositor's keys (⌃N, Page Down, Home…) move it as ↑ and ↓ do; `latest` is read when they come.
  useEffect(() => keys?.subscribe((how) => setHeld((now) => moveSelection(latest.current, now, how))), [keys]);

  const restart = (next: string) => {
    setQuery(next);
    setHeld(null);
    setAllApps(false);
    setFailed(null);
  };

  const act = (row: Row | undefined) => {
    if (!row) return;
    const action = row.action;
    switch (action.kind) {
      case "open":
        if (!onOpen(action.entry)) {
          setFailed(action.entry);
          setHeld(`failed:${action.entry.id}`);
        }
        return;
      case "open-file":
        return onOpenFile?.(action.file);
      case "copy":
        if (!copy) return setCopied({ query: text, ok: false });
        void copy(action.text).then((ok) => setCopied({ query: text, ok }));
        return;
      case "type":
        return restart(action.query);
      case "search-files":
        return onSearchFiles?.(action.query);
      case "find-software":
        return onFindSoftware?.(action.query);
      case "all-apps":
        offset.current = 0;
        setAllApps(true);
        setHeld(null);
        return;
    }
  };

  const drawn = (section: (typeof sections)[number]): Row[] => {
    if (section.id !== "all") return section.rows;
    const index = Math.max(
      0,
      section.rows.findIndex((row) => row.id === selected),
    );
    offset.current = keepInView(index, offset.current, ALL_APPS_ROWS, section.rows.length);
    return section.rows.slice(offset.current, offset.current + ALL_APPS_ROWS);
  };

  let list: ReactNode = null;
  if (sections.length > 0) {
    list = (
      <View testID="launcher:list" style={{ flexDirection: "column", borderTopWidth: 1, borderColor: colors.separator, padding: LAUNCHER.padding }}>
        {sections.map((section) => (
          <View key={section.id} testID={`launcher:section:${section.id}`} style={{ flexDirection: "column" }}>
            {section.title !== undefined && <SectionHead title={section.title} {...(section.aside ? { aside: section.aside } : {})} />}
            {drawn(section).map((row) => (
              <ResultRow key={row.id} row={row} selected={row.id === selected} onPress={() => act(row)} onHover={() => setHeld(row.id)} />
            ))}
            {section.reserved !== undefined && <ReservedRows count={section.reserved} />}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center" }}>
      {/* A click anywhere outside the panel closes the launcher. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
      <View
        occlude
        style={{
          width: LAUNCHER.width,
          flexDirection: "column",
          borderRadius: LAUNCHER.radius,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.separator,
          shadow: "xl",
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 16, height: LAUNCHER.field }}>
          <Svg markup={SEARCH} size={18} color={colors.textMuted} />
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
            <TextInput
              testID="launcher:field"
              value={query}
              autoFocus
              onChangeText={restart}
              onSubmitEditing={() => act(rows.find((row) => row.id === selected))}
              onKeyPress={(key) => {
                if (key === "ArrowDown") return move("down");
                if (key === "ArrowUp") return move("up");
                // Esc steps out: All apps, then the typed words, then the launcher.
                if (allApps && !query) return setAllApps(false);
                if (query) return restart("");
                onClose();
              }}
              // Empty, the field is only as wide as its caret, and the placeholder is drawn after it:
              // Metal hides a focused field's own placeholder, and this one is always focused.
              style={{ ...(query ? { flex: 1 } : { width: 8 }), fontSize: LAUNCHER.fieldText, color: colors.text }}
            />
            {!query && (
              <View testID="launcher:placeholder" style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: LAUNCHER.fieldText, color: colors.textMuted }}>
                  {placeholderFor(files !== undefined && !filesOff)}
                </Text>
              </View>
            )}
          </View>
        </View>
        {list}
      </View>
    </View>
  );
}
