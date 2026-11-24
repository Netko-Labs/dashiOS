/**
 * Settings › Voice › Dictation's profiles and words (voice.tsx;
 * dictation/lexicon.ts): the five profiles and where each is used, the
 * words dictation writes the person's way and the replacements, with add
 * and remove. They are plain files in `~/.config/dashi/dictation/`, which
 * a button opens; what is changed here is written there.
 */

import { MoreButton, SPACE, TextField, TYPE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { Profile } from "../../../dictation/index.ts";
import { Caption, Group } from "../../../shared/cards/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneContext } from "../../context.ts";
import type { PersonOnly } from "../person-only.ts";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { ListRow, MiniButton, Value } from "./parts.tsx";

type Source = NonNullable<PaneContext["dictation"]>;

/** How many of a list show before "Show all". */
const FIRST = 8;

/** Where a profile is used, in a few words: "Terminals, editors · github.com and 5 more". */
export function profileWords(profile: Profile): string {
  if (!profile.tidy) return "Nothing changed but spacing. Chosen from the capsule.";
  const some = (list: readonly string[], most: number): string =>
    list.length <= most ? list.join(", ") : `${list.slice(0, most).join(", ")} and ${list.length - most} more`;
  const where = [some(profile.apps, 3), some(profile.sites, 2)].filter(Boolean).join(" · ");
  return where === "" ? "Chosen from the capsule." : where;
}

/** The compact list sunk under the add row (SE-8's one other row): 28 tall, 12.5. */
const ITEM = { height: 28, gap: SPACE.m, between: SPACE.xxs } as const;

interface ItemsProps {
  kind: "word" | "replacement";
  items: readonly { key: string; text: string; detail?: string }[];
  onRemove(key: string): void;
}

/** A list of words or replacements, each with Remove; the first few, then all. */
function Items({ kind, items, onRemove }: ItemsProps) {
  const colors = useColors();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <View style={{ flexDirection: "column", gap: ITEM.between }}>
      {shown.map((item) => (
        <View
          key={item.key}
          testID={`dictation-${kind}:${item.key}`}
          style={{ flexDirection: "row", alignItems: "center", gap: ITEM.gap, minHeight: ITEM.height }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.panel.body.size, color: colors.text }}>
              {item.text}
            </Text>
          </View>
          {item.detail !== undefined && (
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: TYPE.panel.detail.size, color: colors.textMuted }}>
                {item.detail}
              </Text>
            </View>
          )}
          <MiniButton testID={`dictation-${kind}-remove:${item.key}`} label="Remove" onPress={() => onRemove(item.key)} />
        </View>
      ))}
      {items.length > FIRST && (
        <MoreButton testID={`dictation-${kind}-all`} open={all} more={`Show all ${items.length}`} less="Show fewer" onPress={() => setAll(!all)} />
      )}
    </View>
  );
}

function Words({ source, guard }: { source: Source; guard: PersonOnly }) {
  const { vocabulary } = useSyncExternalStore(source.lexicon.subscribe, source.lexicon.getSnapshot);
  const [word, setWord] = useState("");
  const [heard, setHeard] = useState("");
  const add = (): void => {
    if (word.trim() === "") return;
    guard.mine("voice/dictation-words", () => {
      source.lexicon.addWord(word, heard.split(","));
      setWord("");
      setHeard("");
    });
  };
  const items = [...vocabulary].reverse().map((each) => ({
    key: each.term,
    text: each.term,
    ...(each.heard.length > 0 ? { detail: `heard as ${each.heard.join(", ")}` } : {}),
  }));
  return (
    <Setting id="voice/dictation-words" testID="voice-dictation-words" stack>
      <View style={{ alignSelf: "stretch", flexDirection: "column", gap: SPACE.s }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <TextField
            look="panel"
            testID="dictation-word-add"
            value={word}
            onChangeText={setWord}
            onSubmit={add}
            placeholder="A name or term, as you write it"
          />
          <TextField look="panel" testID="dictation-word-heard" value={heard} onChangeText={setHeard} onSubmit={add} placeholder="Heard as (optional)" />
          <MiniButton testID="dictation-word-add-button" label="Add" tone="primary" disabled={word.trim() === ""} onPress={add} />
        </View>
        <Items kind="word" items={items} onRemove={(term) => guard.mine("voice/dictation-words", () => source.lexicon.removeWord(term))} />
      </View>
    </Setting>
  );
}

function Replacements({ source, guard }: { source: Source; guard: PersonOnly }) {
  const { replacements } = useSyncExternalStore(source.lexicon.subscribe, source.lexicon.getSnapshot);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ready = from.trim() !== "" && to.trim() !== "";
  const add = (): void => {
    if (!ready) return;
    guard.mine("voice/dictation-replacements", () => {
      source.lexicon.addReplacement(from, to);
      setFrom("");
      setTo("");
    });
  };
  const items = [...replacements].reverse().map((pair) => ({ key: pair.from, text: `${pair.from} → ${pair.to}` }));
  return (
    <Setting id="voice/dictation-replacements" testID="voice-dictation-replacements" stack>
      <View style={{ alignSelf: "stretch", flexDirection: "column", gap: SPACE.s }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <TextField look="panel" testID="dictation-replacement-from" value={from} onChangeText={setFrom} onSubmit={add} placeholder="What is heard" />
          <TextField look="panel" testID="dictation-replacement-to" value={to} onChangeText={setTo} onSubmit={add} placeholder="What is typed" />
          <MiniButton testID="dictation-replacement-add-button" label="Add" tone="primary" disabled={!ready} onPress={add} />
        </View>
        <Items
          kind="replacement"
          items={items}
          onRemove={(heard) => guard.mine("voice/dictation-replacements", () => source.lexicon.removeReplacement(heard))}
        />
      </View>
    </Setting>
  );
}

export function DictationWordsRows({ source, guard }: { source: Source; guard: PersonOnly }) {
  const { profiles } = useSyncExternalStore(source.lexicon.subscribe, source.lexicon.getSnapshot);
  return (
    <>
      <Caption above>Dictation profiles</Caption>
      <Group testID="voice-dictation-profiles">
        {profiles.map((profile) => (
          <ListRow key={profile.id} testID={`dictation-profile:${profile.id}`} name={profile.name} detail={profileWords(profile)}>
            {profile.words.length > 0 && <Value>{`${profile.words.length} words`}</Value>}
          </ListRow>
        ))}
        <View style={{ flexDirection: "row", paddingLeft: PAGE.inset, paddingRight: PAGE.inset, paddingVertical: PAGE.pad }}>
          <MiniButton testID="dictation-open-folder" label="Open the folder" onPress={source.openFolder} />
        </View>
      </Group>
      <Caption>
        Dashi picks the profile by the app, the site and the field. Its name shows on the capsule: press it there to change it for that window. Each is a file
        you can edit.
      </Caption>
      <Group testID="voice-dictation-vocabulary">
        <Words source={source} guard={guard} />
        <Replacements source={source} guard={guard} />
      </Group>
    </>
  );
}
