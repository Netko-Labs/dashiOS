/**
 * Emoji, a first-party launcher extension written on Dashi's extension API
 * (docs/launcher-extensions.md): a grid the launcher draws (store-v2 frame
 * L12). It filters itself, so only what is typed travels: ↩ copies the
 * emoji, ❖↩ pastes it into the window that was in front.
 */

import { defineApplet } from "@dashi/applet";
import { Action, ActionPanel, Grid } from "@dashi/applet/launcher";
import { useMemo, useState } from "react";
import { allEmoji, findEmoji } from "./lib/search.ts";

const ALL = allEmoji();

function SearchEmoji() {
  const [query, setQuery] = useState("");
  const found = useMemo(() => findEmoji(ALL, query), [query]);
  const group = query.trim() ? `${found.length === 0 ? "No" : found.length} emoji` : found[0]?.group;
  return (
    <Grid filter="extension" columns={8} placeholder="Search emoji by name" onSearchTextChange={setQuery}>
      {found.length > 0 && (
        <Grid.Section title={group ?? "Emoji"}>
          {found.map((emoji) => (
            <Grid.Item
              key={emoji.char}
              id={emoji.char.codePointAt(0)?.toString(16) ?? emoji.name}
              title={emoji.name}
              content={{ emoji: emoji.char }}
              actions={
                <ActionPanel>
                  <Action.Copy title="Copy Emoji" content={emoji.char} />
                  <Action.Paste title="Paste Emoji" content={emoji.char} />
                </ActionPanel>
              }
            />
          ))}
        </Grid.Section>
      )}
      {found.length === 0 && <Grid.EmptyView title={`No emoji called “${query.trim()}”`} description="Try another word: heart, cat, rocket" />}
    </Grid>
  );
}

export default defineApplet({ commands: { emoji: { view: SearchEmoji } } });
