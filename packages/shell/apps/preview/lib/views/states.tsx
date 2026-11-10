/**
 * What the picture area shows when there is no picture: the empty window
 * (drop a file, Open…, and the files opened lately), and an error, which is
 * not an empty state (PA-6): it names the file, says what happened, and
 * offers what can be done next.
 */

import { basename, dirname } from "node:path";
import { Button, EmptyState, useColors, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import * as glyphs from "../glyphs.ts";
import type { Recent } from "../memory.ts";

/** How many recent files the empty window lists. */
export const EMPTY_RECENTS = 5;
/** The most a recent row's folder takes (it ends in an ellipsis past it); the name has the rest. */
export const RECENT_FOLDER_WIDTH = 120;

/** A folder for a recent row's second word: the home folder as "~". */
export function shortFolder(path: string, home: string = process.env.HOME ?? ""): string {
  const folder = dirname(path);
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}

export function EmptyView({ recents, onOpen, onRecent }: { recents: readonly Recent[]; onOpen: () => void; onRecent: (path: string) => void }) {
  const colors = useColors();
  const shown = recents.slice(0, EMPTY_RECENTS);
  return (
    <EmptyState
      testID="empty"
      title="No file open"
      message="Drop a picture or a PDF here, or choose one."
      glyph={glyphs.PICTURE}
      action={
        <View style={{ flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Button testID="open" label="Open…" primary onPress={onOpen} />
          {shown.length > 0 && (
            <View testID="recents" focusGroup style={{ flexDirection: "column", gap: 2, width: 320 }}>
              <View style={{ paddingHorizontal: 8, paddingBottom: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>Recent</Text>
              </View>
              {shown.map((recent) => (
                <View
                  key={recent.path}
                  testID={`recent:${basename(recent.path)}`}
                  focusable
                  accessibilityRole="button"
                  accessibilityLabel={basename(recent.path)}
                  onPress={() => onRecent(recent.path)}
                  style={{
                    height: 30,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 8,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.button,
                  }}
                >
                  <Svg markup={/\.pdf$/i.test(recent.path) ? glyphs.DOCUMENT : glyphs.PICTURE} size={16} color={colors.textMuted} />
                  {/* The name takes the room and gives way with an ellipsis; the folder keeps its column in every row. */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
                      {basename(recent.path)}
                    </Text>
                  </View>
                  <View testID={`recent-folder:${basename(recent.path)}`} style={{ flexShrink: 0, maxWidth: RECENT_FOLDER_WIDTH }}>
                    <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted, textAlign: "right" }}>
                      {shortFolder(recent.path)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      }
    />
  );
}

export function ErrorView({ name, message, onOpenWith, onOpen }: { name: string; message: string; onOpenWith: (() => void) | null; onOpen: () => void }) {
  const colors = useColors();
  return (
    <View testID="error" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", maxWidth: 440 }}>
        <Svg markup={WARNING} size={28} color={colors.broth} />
        <View style={{ flexDirection: "column", gap: 4, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{`“${name}” can’t be shown`}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{message}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {onOpenWith && <Button testID="error:open-with" label="Open With…" onPress={onOpenWith} />}
            <Button testID="error:open" label="Open Another…" onPress={onOpen} />
          </View>
        </View>
      </View>
    </View>
  );
}
