/**
 * Settings › Your Dashi's row for "What Dashi knows about you"
 * (persona/lib/about.ts; decisions.md D151): how much the file holds, and a
 * button that opens it, so the person reads and edits every word of it.
 */

import { useState } from "react";
import { ensureAbout, readAbout } from "../../../persona/index.ts";
import { Group } from "../../../shared/cards/index.ts";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";

/** "3 lines", "Nothing yet". */
export const aboutWords = (text: string): string => {
  const lines = text.split("\n").filter((line) => line.trim() !== "").length;
  return lines === 0 ? "Nothing yet" : lines === 1 ? "1 line" : `${lines} lines`;
};

export function AboutYou({ openFile }: { openFile(path: string): void }) {
  // Read as the pane shows, and again when the file is opened: it is the person's to change in the editor.
  const [text, setText] = useState(() => readAbout());
  return (
    <Group testID="persona-about">
      <Setting id="persona/about" testID="persona-about-row" detail={`${aboutWords(text)}. Dashi adds a line only when you say “remember that…”.`}>
        <MiniButton
          testID="persona-about-open"
          label="Open"
          onPress={() => {
            openFile(ensureAbout());
            setText(readAbout());
          }}
        />
      </Setting>
    </Group>
  );
}
