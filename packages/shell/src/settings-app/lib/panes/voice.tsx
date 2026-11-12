/**
 * Voice: talking to Dashi. Off until turned on here. Turning it on says what
 * will be fetched and how big it is, then fetches the models with progress,
 * Pause and Resume; nothing is fetched before that, and never at install.
 * Then the talk key, Dashi's voice (with a sample), the optional model for
 * more languages, and removing the models. What is missing is said here in
 * words, with the one thing to do.
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
  type TalkKeyId,
  talkKey,
  type VoiceParts,
} from "../../../voice/index.ts";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page, Switch } from "../../ui.tsx";
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
}: {
  id: "voice/models" | "voice/more-languages";
  sets: readonly ModelSet[];
  view: ModelsView;
  voice: VoicePaneSource;
  /** What the row says while nothing is here. */
  offer: string;
  onFetch: () => void;
}) {
  const ids = sets.map((set) => set.id);
  const fetching = view.fetching && whatFetching(view.fetching.sets, ids) ? view.fetching : null;
  const busy = view.fetching !== null && fetching === null;
  const here = sets.length > 0 && sets.every((set) => set.installed);
  const part = partly(sets);
  const bytes = sets.reduce((sum, set) => sum + set.bytes, 0);
  const have = sets.reduce((sum, set) => sum + set.have, 0);
  const detail = fetching
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
        <Remove testID={`${id.replace("/", "-")}-remove`} onRemove={() => void voice.models.remove(removeWords(id, ids))} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {part && <Remove testID={`${id.replace("/", "-")}-remove`} onRemove={() => void voice.models.remove(removeWords(id, ids))} />}
          <MiniButton testID={`${id.replace("/", "-")}-fetch`} label={part ? "Resume" : "Fetch"} tone="primary" disabled={busy} onPress={onFetch} />
        </View>
      )}
    </Setting>
  );
}

function KeyAndVoice({ settings, voice, view }: { settings: SettingsStore; voice: VoicePaneSource; view: ModelsView }) {
  const chosen = useSettings(settings).data.voice;
  const key = talkKey(chosen.key as TalkKeyId | undefined);
  const spoken = chosen.voice ?? view.defaultVoice;
  const choices = voiceChoices(view.voices, view.defaultVoice);
  return (
    <Group testID="voice-key-and-voice">
      <Setting id="voice/key" testID="voice-key" detail={`Hold ${key.hold} to talk, and let go to hear the answer. ${key.cost ?? ""}`.trim()} stack>
        <FoldedChoices
          testID="voice-key-choice"
          value={key.id}
          options={TALK_KEYS.map((each) => ({ value: each.id, label: each.label }))}
          onChange={(id) => settings.patch("voice", { key: id === "default" ? undefined : id })}
        />
      </Setting>
      {choices.length > 0 && (
        <Setting id="voice/dashis-voice" testID="voice-voice" stack>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FoldedChoices
              testID="voice-voice-choice"
              value={spoken}
              options={choices}
              common={choices.slice(0, 4).map((each) => each.value)}
              onChange={(id) => settings.patch("voice", { voice: id === view.defaultVoice ? undefined : id })}
            />
            <MiniButton testID="voice-sample" label="Play a sample" onPress={() => voice.sample(spoken)} />
          </View>
        </Setting>
      )}
    </Group>
  );
}

export function VoicePane({ settings, voice }: { settings: SettingsStore; voice: VoicePaneSource }) {
  const view = useSyncExternalStore(voice.models.subscribe, voice.models.getSnapshot);
  const on = useSettings(settings).data.voice.on === true;
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
  const turn = (next: boolean): void => {
    if (next && !usable) return setAsking(true);
    setAsking(false);
    settings.patch("voice", { on: next ? true : undefined });
  };
  const fetchBasics = (): void => {
    setAsking(false);
    settings.patch("voice", { on: true });
    void voice.models.fetch();
  };
  const offer = `Voice needs ${sizeWords(need)} of models, fetched once and kept on this computer: ${setsWords(basics, true)}.`;
  return (
    <Page title="Voice">
      <Group testID="voice-main">
        <Setting id="voice/on" testID="voice-on" {...(on && !usable ? { detail: "On, once its models are here." } : {})}>
          <Switch testID="voice-switch" on={on || asking} onChange={turn} />
        </Setting>
        {(on || asking || partly(basics) || usable) && (
          <ModelsRow id="voice/models" sets={basics} view={view} voice={voice} offer={offer} onFetch={fetchBasics} />
        )}
      </Group>
      {view.error !== null && <Note testID="voice-error">{view.error}</Note>}
      {on && usable && <KeyAndVoice settings={settings} voice={voice} view={view} />}
      {on && usable && more.length > 0 && (
        <Group testID="voice-more">
          <ModelsRow
            id="voice/more-languages"
            sets={more}
            view={view}
            voice={voice}
            offer={`${more.map((set) => set.about).join(" ")} Optional: ${setsWords(more, true)}.`}
            onFetch={() => void voice.models.fetch(more.map((set) => set.id))}
          />
        </Group>
      )}
      <Caption>{[...basics, ...(on && usable ? more : [])].map((set) => set.credit).join(" ")}</Caption>
    </Page>
  );
}
