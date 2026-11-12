/**
 * Voice: talking to Dashi. Off until turned on here. Turning it on says what
 * will be fetched and how big it is, then fetches the models with progress,
 * Pause and Resume; nothing is fetched before that, and never at install.
 * Then the talk key, Dashi's voice (with a sample), the optional model for
 * more languages, and removing the models. What is missing is said here in
 * words, with the one thing to do.
 *
 * The switch reads on when Voice is on: asked for and its models here. Until
 * then it reads off, and the row says what it waits for. Only the person's
 * own press turns it on, fetches, removes, or picks the key and the voice
 * (person-only.ts): an agent's press changes nothing and the row says so.
 */

import { Text, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { FoldedChoices } from "../../../shared/controls/folded.tsx";
import {
  basicSets,
  basicsHere,
  type ModelSet,
  type ModelsView,
  partly,
  sizeWords,
  TALK_KEYS,
  type TalkKey,
  type TalkKeyId,
  talkKey,
  type VoiceParts,
} from "../../../voice/index.ts";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page, Switch } from "../../ui.tsx";
import { type ByPerson, ONLY_YOU, type PersonOnly, usePersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";
import { removeWords, setsWords, voiceChoices, whatFetching } from "./voice-words.ts";

export type VoicePaneSource = Pick<VoiceParts, "models" | "sample">;

/** A fetch's progress: a bar, and "412 MB of 1.01 GB". */
function Progress({ received, bytes, testID }: { received: number; bytes: number; testID: string }) {
  const colors = useColors();
  const part = bytes > 0 ? Math.min(1, received / bytes) : 0;
  return (
    <View testID={testID} accessibilityLabel={`${Math.round(part * 100)}% fetched`} style={{ alignSelf: "stretch", flexDirection: "column", gap: 5 }}>
      <View style={{ alignSelf: "stretch", height: 6, borderRadius: 3, backgroundColor: colors.button, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(part * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.text }} />
      </View>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{bytes > 0 ? `${sizeWords(received)} of ${sizeWords(bytes)}` : "Starting…"}</Text>
    </View>
  );
}

/** "Remove…" that asks first, in place. */
function Remove({ testID, onRemove }: { testID: string; onRemove: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <MiniButton testID={testID} label="Remove…" tone="critical" onPress={() => setAsking(true)} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <MiniButton testID={`${testID}:cancel`} label="Cancel" onPress={() => setAsking(false)} />
      <MiniButton
        testID={`${testID}:confirm`}
        label="Remove"
        tone="critical"
        onPress={() => {
          setAsking(false);
          onRemove();
        }}
      />
    </View>
  );
}

/** One group of model sets: what a fetch would bring, its progress with Pause, going on with Resume, or Remove once here. */
function ModelsRow({
  id,
  sets,
  view,
  voice,
  offer,
  onFetch,
  guard,
}: {
  id: "voice/models" | "voice/more-languages";
  sets: readonly ModelSet[];
  view: ModelsView;
  voice: VoicePaneSource;
  /** What the row says while nothing is here. */
  offer: string;
  onFetch: () => void;
  /** Fetching and removing are the person's alone. */
  guard: PersonOnly;
}) {
  const ids = sets.map((set) => set.id);
  const fetching = view.fetching && whatFetching(view.fetching.sets, ids) ? view.fetching : null;
  const busy = view.fetching !== null && fetching === null;
  const here = sets.length > 0 && sets.every((set) => set.installed);
  const part = partly(sets);
  const bytes = sets.reduce((sum, set) => sum + set.bytes, 0);
  const have = sets.reduce((sum, set) => sum + set.have, 0);
  const remove = (): void => guard.mine(id, () => void voice.models.remove(removeWords(id, ids)));
  const detail =
    guard.refused === id
      ? ONLY_YOU
      : fetching
        ? `Fetching ${setsWords(sets)}.`
        : here
          ? `On this computer: ${setsWords(sets)}.`
          : part
            ? `Paused at ${sizeWords(have)} of ${sizeWords(bytes)}. What came is kept.`
            : offer;
  return (
    <Setting
      id={id}
      testID={id.replace("/", "-")}
      detail={detail}
      {...(fetching ? { below: <Progress testID={`${id.replace("/", "-")}-progress`} received={fetching.received} bytes={fetching.bytes} /> } : {})}
    >
      {fetching ? (
        <MiniButton testID={`${id.replace("/", "-")}-pause`} label="Pause" onPress={() => void voice.models.pause()} />
      ) : here ? (
        <Remove testID={`${id.replace("/", "-")}-remove`} onRemove={remove} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {part && <Remove testID={`${id.replace("/", "-")}-remove`} onRemove={remove} />}
          <MiniButton
            testID={`${id.replace("/", "-")}-fetch`}
            label={part ? "Resume" : "Fetch"}
            tone="primary"
            disabled={busy}
            onPress={() => guard.mine(id, onFetch)}
          />
        </View>
      )}
    </Setting>
  );
}

function KeyAndVoice({ settings, voice, view, guard }: { settings: SettingsStore; voice: VoicePaneSource; view: ModelsView; guard: PersonOnly }) {
  const chosen = useSettings(settings).data.voice;
  const key = talkKey(chosen.key as TalkKeyId | undefined);
  const spoken = chosen.voice ?? view.defaultVoice;
  const choices = voiceChoices(view.voices, view.defaultVoice);
  return (
    <Group testID="voice-key-and-voice">
      <Setting id="voice/key" testID="voice-key" detail={guard.refused === "voice/key" ? ONLY_YOU : keyWords(key)} stack>
        <FoldedChoices
          testID="voice-key-choice"
          value={key.id}
          options={TALK_KEYS.map((each) => ({ value: each.id, label: each.label }))}
          onChange={(id) => guard.mine("voice/key", () => settings.patch("voice", { key: id === "default" ? undefined : id }))}
        />
      </Setting>
      {choices.length > 0 && (
        <Setting id="voice/dashis-voice" testID="voice-voice" {...(guard.refused === "voice/dashis-voice" ? { detail: ONLY_YOU } : {})} stack>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FoldedChoices
              testID="voice-voice-choice"
              value={spoken}
              options={choices}
              common={choices.slice(0, 4).map((each) => each.value)}
              onChange={(id) => guard.mine("voice/dashis-voice", () => settings.patch("voice", { voice: id === view.defaultVoice ? undefined : id }))}
            />
            <MiniButton testID="voice-sample" label="Play a sample" onPress={() => voice.sample(spoken)} />
          </View>
        </Setting>
      )}
    </Group>
  );
}

/** What the key's row says: how it talks, how a tap of it talks where one does, and what it no longer does. */
export function keyWords(key: TalkKey): string {
  return [`Hold ${key.hold} to talk, and let go to hear the answer.`, key.tap, key.cost].filter(Boolean).join(" ");
}

/** What the switch's row says: an agent's press, what Voice waits for, or the registry's own words. */
export function switchDetail(state: { wanted: boolean; usable: boolean; refused: boolean }): string | undefined {
  if (state.refused) return ONLY_YOU;
  return state.wanted && !state.usable ? "It turns on once its models are here." : undefined;
}

export function VoicePane({ settings, voice, byPerson }: { settings: SettingsStore; voice: VoicePaneSource; byPerson?: ByPerson }) {
  const view = useSyncExternalStore(voice.models.subscribe, voice.models.getSnapshot);
  // Asked for (settings.json); it is on once its models are here too.
  const wanted = useSettings(settings).data.voice.on === true;
  const guard = usePersonOnly(byPerson);
  // Turning it on with no models: say what comes and how big it is before anything is fetched.
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void voice.models.refresh();
  }, [voice]);
  if (view.service !== "ready") {
    return (
      <Page title="Voice">
        <Group testID="voice-missing">
          <Note>{view.service === "looking" ? "Looking for Voice…" : "Voice isn't running in this session. Log out and in again to start it."}</Note>
        </Group>
      </Page>
    );
  }
  const basics = basicSets(view.sets);
  const more = view.sets.filter((set) => !set.basic);
  const usable = basicsHere(view.sets);
  const need = basics.reduce((sum, set) => sum + set.bytes - set.have, 0);
  const on = wanted && usable;
  const turn = (next: boolean): void => {
    // Off, or taking back an ask that hasn't its models yet: stopping only narrows, so anyone may.
    if (!next || wanted || asking) {
      setAsking(false);
      settings.patch("voice", { on: undefined });
      return;
    }
    guard.mine("voice/on", () => (usable ? settings.patch("voice", { on: true }) : setAsking(true)));
  };
  const fetchBasics = (): void => {
    setAsking(false);
    settings.patch("voice", { on: true });
    void voice.models.fetch();
  };
  const detail = switchDetail({ wanted, usable, refused: guard.refused === "voice/on" });
  const offer = `Voice needs ${sizeWords(need)} of models, fetched once and kept on this computer: ${setsWords(basics, true)}.`;
  return (
    <Page title="Voice">
      <Group testID="voice-main">
        <Setting id="voice/on" testID="voice-on" {...(detail === undefined ? {} : { detail })}>
          {/* On when Voice is on, never while it only offers the fetch. */}
          <Switch testID="voice-switch" on={on} onChange={turn} />
        </Setting>
        {(wanted || asking || partly(basics) || usable) && (
          <ModelsRow id="voice/models" sets={basics} view={view} voice={voice} offer={offer} onFetch={fetchBasics} guard={guard} />
        )}
      </Group>
      {view.error !== null && <Note testID="voice-error">{view.error}</Note>}
      {on && <KeyAndVoice settings={settings} voice={voice} view={view} guard={guard} />}
      {on && more.length > 0 && (
        <Group testID="voice-more">
          <ModelsRow
            id="voice/more-languages"
            sets={more}
            view={view}
            voice={voice}
            offer={`${more.map((set) => set.about).join(" ")} Optional: ${setsWords(more, true)}.`}
            onFetch={() => void voice.models.fetch(more.map((set) => set.id))}
            guard={guard}
          />
        </Group>
      )}
      <Caption>{[...basics, ...(on ? more : [])].map((set) => set.credit).join(" ")}</Caption>
    </Page>
  );
}
