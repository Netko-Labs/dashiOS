/**
 * What the picture area shows when there is no picture: the empty window
 * (drop a file, Open…, and the files opened lately), and an error, which is
 * not an empty state (PA-6): the kit's ErrorState names the file in ume,
 * says what happened, and offers what can be done next.
 */

import { basename, dirname } from "node:path";
import { Button, EmptyState, ErrorState, PickRow, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import * as glyphs from "../glyphs.ts";
import type { Recent } from "../memory.ts";

/** How many recent files the empty window lists. */
export const EMPTY_RECENTS = 5;
/** The recent list's width, and the most characters a row's folder keeps before it is shortened (the name has the rest). */
export const RECENTS = { width: 320, folderChars: 20 } as const;

/** A folder for a recent row's detail: the home folder as "~", and a long one as its last part, cut with an ellipsis. */
export function shortFolder(path: string, home: string = process.env.HOME ?? ""): string {
  const folder = dirname(path);
  const short = home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;
  if (short.length <= RECENTS.folderChars) return short;
  const last = basename(short);
  return last.length < RECENTS.folderChars ? `…/${last}` : `${last.slice(0, RECENTS.folderChars - 1)}…`;
}

/** The files opened lately, as pick rows (UI-13): a press opens one, ↑ ↓ walk them, Return opens. */
function Recents({ recents, onRecent }: { recents: readonly Recent[]; onRecent: (path: string) => void }) {
  const colors = useColors();
  return (
    <View testID="recents" focusGroup style={{ flexDirection: "column", gap: SPACE.px, width: RECENTS.width }}>
      <View style={{ paddingHorizontal: SPACE.m, paddingBottom: SPACE.xxs }}>
        <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>Recent</Text>
      </View>
      {recents.map((recent) => (
        <PickRow
          key={recent.path}
          testID={`recent:${basename(recent.path)}`}
          label={basename(recent.path)}
          detail={shortFolder(recent.path)}
          glyph={/\.pdf$/i.test(recent.path) ? glyphs.DOCUMENT : glyphs.PICTURE}
          chosen={false}
          onPress={() => onRecent(recent.path)}
        />
      ))}
    </View>
  );
}

export function EmptyView({ recents, onOpen, onRecent }: { recents: readonly Recent[]; onOpen: () => void; onRecent: (path: string) => void }) {
  const shown = recents.slice(0, EMPTY_RECENTS);
  return (
    <EmptyState
      testID="empty"
      title="No file open"
      message="Drop a picture or a PDF here, or choose one."
      glyph={glyphs.PICTURE}
      action={
        <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.page }}>
          <Button testID="open" label="Open…" primary onPress={onOpen} />
          {shown.length > 0 && <Recents recents={shown} onRecent={onRecent} />}
        </View>
      }
    />
  );
}

/** A file that can't be shown (PA-6): the kit's error state, ume, naming the file, with its ways on. */
export function ErrorView({ name, message, onOpenWith, onOpen }: { name: string; message: string; onOpenWith: (() => void) | null; onOpen: () => void }) {
  return (
    <ErrorState
      testID="error"
      title={`“${name}” can’t be shown.`}
      message={message}
      actions={
        <>
          {onOpenWith && <Button testID="error:open-with" label="Open with…" onPress={onOpenWith} />}
          <Button testID="error:open" label="Open another…" onPress={onOpen} />
        </>
      }
    />
  );
}
