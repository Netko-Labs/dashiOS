/**
 * Your Dashi: who the assistant is. Its name, one of six characters or the person's own from a
 * small file, what it calls them, how much it talks, the language and the voice it answers in, and
 * the colour and mark of its capsule, shown as it will look. A character changes how Dashi sounds
 * and looks, never what it may do (docs/decisions.md D58), and the pane says so.
 *
 * Every row is the person's alone: each change first asks whose press it was (person-only.ts),
 * and an agent's changes nothing. Choosing a character is one change and one Undo.
 */

import { View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import {
  CHARACTERS,
  type Character,
  checkName,
  chooseCharacter,
  makeCharacterFile,
  NAME_MAX,
  NOTE_MAX,
  type PersonaSection,
  type PersonaSource,
  previewLine,
  YOU_MAX,
} from "../../../persona/index.ts";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { FoldedChoices } from "../../../shared/controls/folded.tsx";
import { PERSONA_MARKS, PERSONA_TALK } from "../../../shared/pill/index.ts";
import { basicsHere } from "../../../voice/index.ts";
import type { PaneContext } from "../../context.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Hero, Page } from "../../ui.tsx";
import { LANGUAGE_WORDS, TALK_WORDS } from "../changes/words.ts";
import { type ByPerson, ONLY_YOU, type PersonOnly, usePersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";
import { CapsulePreview, CharacterFilesNotes, LineField, Swatches } from "./persona-parts.tsx";
import type { VoicePaneSource } from "./voice.tsx";
import { voiceChoices } from "./voice-words.ts";

/** What sits under the last card. */
export const PERSONA_PROMISE =
  "A character changes how Dashi sounds and looks. It never changes what Dashi may do: it still asks before it sends, pays, signs in or moves anything to the Trash.";

const EVERY_KEY: PersonaSection = {
  name: undefined,
  character: undefined,
  colour: undefined,
  mark: undefined,
  talk: undefined,
  you: undefined,
  language: undefined,
  note: undefined,
};

const NO_VOICE = { subscribe: () => () => {}, getSnapshot: () => null };

export interface PersonaPaneProps {
  settings: SettingsStore;
  persona: { source: PersonaSource; openFile(path: string): void };
  voice?: VoicePaneSource;
  byPerson?: ByPerson;
}

interface Parts extends PersonaPaneProps {
  guard: PersonOnly;
  /** The voices here and Dashi's own; null while Voice is off or its models are not here. */
  voices: { choices: Array<{ value: string; label: string }>; own: string } | null;
}

/** The registry's line, or that only the person changes this row. */
const quiet = (guard: PersonOnly, row: string, detail?: string): { detail?: string } =>
  guard.refused === row ? { detail: ONLY_YOU } : detail === undefined ? {} : { detail };

function Who({ settings, persona, guard, voices }: Parts) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  const files = persona.source.files().characters;
  const language = persona.source.language();
  const [problem, setProblem] = useState<string | null>(null);
  const keepName = (typed: string): void => {
    const check = checkName(typed);
    setProblem(check.ok ? null : check.why);
    if (check.ok) guard.mine("persona/name", () => settings.patch("persona", { name: typed.trim() === "" ? undefined : check.name }));
  };
  const choose = (to: Character): void =>
    guard.mine("persona/character", () => {
      const choice = chooseCharacter(
        view,
        to,
        language,
        files,
        (voices?.choices ?? []).map((each) => each.value),
      );
      // One entry in Recently changed, one Undo: the character with its look, its talk and its voice.
      settings.changes.group(null, () => {
        settings.patch("persona", choice.persona);
        if (choice.voice !== undefined) settings.patch("voice", { voice: choice.voice });
      });
    });
  const all = [...CHARACTERS, ...files];
  const about = view.missing !== null ? `The file for “${view.missing}” is gone or wrong. It is Dashi until the file is back.` : view.character.about[language];
  return (
    <Group testID="persona-who">
      <Setting id="persona/name" testID="persona-name" {...quiet(guard, "persona/name", problem ?? undefined)}>
        <LineField testID="persona-name-field" value={view.name} placeholder="Dashi" max={NAME_MAX} onKeep={keepName} onDraft={() => setProblem(null)} />
      </Setting>
      <Setting id="persona/character" testID="persona-character" {...quiet(guard, "persona/character", about)} stack>
        <FoldedChoices
          testID="persona-character-choice"
          value={view.character.id}
          options={all.map((each) => ({ value: each.id, label: each.name }))}
          common={CHARACTERS.slice(0, 4).map((each) => each.id)}
          onChange={(id) => {
            const to = all.find((each) => each.id === id);
            if (to) choose(to);
          }}
        />
      </Setting>
      <Setting id="persona/you" testID="persona-you" {...quiet(guard, "persona/you")}>
        <LineField
          testID="persona-you-field"
          value={view.you}
          placeholder="Alex"
          max={YOU_MAX}
          onKeep={(text) => guard.mine("persona/you", () => settings.patch("persona", { you: text.trim() === "" ? undefined : text.trim() }))}
        />
      </Setting>
    </Group>
  );
}

function Sound({ settings, persona, guard, voices }: Parts) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  return (
    <Group testID="persona-sound">
      <Setting id="persona/talk" testID="persona-talk" {...quiet(guard, "persona/talk")}>
        <FoldedChoices
          testID="persona-talk-choice"
          value={view.talk}
          options={PERSONA_TALK.map((talk) => ({ value: talk, label: TALK_WORDS[talk] ?? talk }))}
          onChange={(talk) => guard.mine("persona/talk", () => settings.patch("persona", { talk }))}
        />
      </Setting>
      <Setting id="persona/language" testID="persona-language" {...quiet(guard, "persona/language")}>
        <FoldedChoices
          testID="persona-language-choice"
          value={view.language}
          options={(["auto", "en", "es"] as const).map((each) => ({ value: each, label: LANGUAGE_WORDS[each] ?? each }))}
          onChange={(language) => guard.mine("persona/language", () => settings.patch("persona", { language }))}
        />
      </Setting>
      <Setting
        id="persona/voice"
        testID="persona-voice"
        {...quiet(guard, "persona/voice", voices ? undefined : "Turn on Voice first.")}
        stack={voices !== null}
      >
        {voices && (
          <FoldedChoices
            testID="persona-voice-choice"
            value={view.voice ?? voices.own}
            options={voices.choices}
            common={voices.choices.slice(0, 4).map((each) => each.value)}
            onChange={(id) => guard.mine("persona/voice", () => settings.patch("voice", { voice: id === voices.own ? undefined : id }))}
          />
        )}
      </Setting>
    </Group>
  );
}

function Look({ settings, persona, guard }: Parts) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  return (
    <Group testID="persona-look">
      <Setting id="persona/colour" testID="persona-colour" {...quiet(guard, "persona/colour")}>
        <Swatches value={view.colour.id} onChange={(colour) => guard.mine("persona/colour", () => settings.patch("persona", { colour: colour.to }))} />
      </Setting>
      <Setting id="persona/mark" testID="persona-mark" {...quiet(guard, "persona/mark")}>
        <FoldedChoices
          testID="persona-mark-choice"
          value={view.mark}
          options={PERSONA_MARKS.map((mark) => ({ value: mark, label: mark === "spark" ? "Spark" : "Dots" }))}
          onChange={(mark) => guard.mine("persona/mark", () => settings.patch("persona", { mark }))}
        />
      </Setting>
    </Group>
  );
}

function Own({ settings, persona, guard }: Parts) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  const [failed, setFailed] = useState(false);
  const make = (): void =>
    guard.mine("persona/own", () => {
      try {
        const made = makeCharacterFile(view.character, persona.source.dir);
        persona.source.refresh();
        settings.patch("persona", { character: made.id });
        persona.openFile(made.path);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  const reset = (): void =>
    guard.mine("persona/reset", () =>
      settings.changes.group(null, () => {
        settings.patch("persona", EVERY_KEY);
        settings.patch("voice", { voice: undefined });
      }),
    );
  return (
    <Group testID="persona-own">
      <Setting id="persona/note" testID="persona-note" {...quiet(guard, "persona/note")} stack>
        <LineField
          testID="persona-note-field"
          value={view.note}
          placeholder="Short answers in the morning. Spanish at home."
          max={NOTE_MAX}
          width="100%"
          onKeep={(text) => guard.mine("persona/note", () => settings.patch("persona", { note: text.trim() === "" ? undefined : text.trim() }))}
        />
      </Setting>
      <Setting id="persona/own" testID="persona-own-row" {...quiet(guard, "persona/own", failed ? "The file could not be made." : undefined)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <MiniButton testID="persona-open-folder" label="Show Folder" onPress={() => persona.openFile(persona.source.dir)} />
          <MiniButton testID="persona-make-file" label="Make a File" onPress={make} />
        </View>
      </Setting>
      <Setting
        id="persona/reset"
        testID="persona-reset-row"
        title="Start over"
        {...quiet(guard, "persona/reset", "Dashi as it came. The files you added stay.")}
      >
        <MiniButton testID="persona-reset" label="Back to Dashi" disabled={!view.set} onPress={reset} />
      </Setting>
    </Group>
  );
}

export function PersonaPane(props: PersonaPaneProps) {
  const { settings, persona, voice } = props;
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  const models = useSyncExternalStore(voice?.models.subscribe ?? NO_VOICE.subscribe, voice?.models.getSnapshot ?? NO_VOICE.getSnapshot);
  const guard = usePersonOnly(props.byPerson);
  const on = useSettings(settings).data.voice.on === true && models !== null && models.service === "ready" && basicsHere(models.sets);
  const choices = on && models ? voiceChoices(models.voices, models.defaultVoice) : [];
  const voices = on && models && choices.length > 0 ? { choices, own: models.defaultVoice } : null;
  const parts: Parts = { ...props, guard, voices };
  return (
    <Page title="Your Dashi">
      <Hero testID="persona-hero">
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 8 }}>
          <CapsulePreview colour={view.colour} mark={view.mark} line={previewLine(view, persona.source.language())} />
          <MiniButton
            testID="persona-hear"
            label={voices ? "Hear it" : "Turn on Voice to hear it"}
            disabled={!voices}
            onPress={() => voice?.sample(view.voice ?? voices?.own ?? "")}
          />
        </View>
      </Hero>
      <Who {...parts} />
      <Sound {...parts} />
      <Look {...parts} />
      <Own {...parts} />
      <CharacterFilesNotes source={persona.source} />
      <Caption>{PERSONA_PROMISE}</Caption>
    </Page>
  );
}

/** The pane as the window draws it: who Dashi is, or that this session does not keep it. */
export function YourDashiPane({ ctx }: { ctx: Pick<PaneContext, "settings" | "persona" | "voice" | "byPerson"> }) {
  if (!ctx.persona) {
    return (
      <Page title="Your Dashi">
        <Group testID="persona-none">
          <Note>Dashi's character isn't kept in this session. Log out and in again to start it.</Note>
        </Group>
      </Page>
    );
  }
  return (
    <PersonaPane
      settings={ctx.settings}
      persona={ctx.persona}
      {...(ctx.voice ? { voice: ctx.voice } : {})}
      {...(ctx.byPerson ? { byPerson: ctx.byPerson } : {})}
    />
  );
}
