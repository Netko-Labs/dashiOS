/**
 * Settings › Voice's rows for the other languages Dashi speaks (voice.tsx): the switch that has
 * each sentence said by a voice of its own language, and under the voice a row for each language
 * that is spoken ("In Spanish"), with the voice that says it, changeable, and a line said in that
 * language. A language that is not spoken is turned on from the last row. They read and write
 * settings.json `voice.voices` and `voice.byLanguage` (voice/tongues.ts); only the person's own
 * press changes them.
 */

import { FoldedChoices, SPACE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { type ModelsView, type SpokenTongue, spokenTongues, type TongueCode, type VoiceParts, withTongue } from "../../../voice/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Switch } from "../../ui.tsx";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";

const OFF = "off";

/** Each language's row in the registry (registry/lib/voice.ts). */
const ROWS = {
  en: "voice/in-en",
  es: "voice/in-es",
  fr: "voice/in-fr",
  hi: "voice/in-hi",
  it: "voice/in-it",
  pt: "voice/in-pt",
} as const satisfies Record<TongueCode, string>;

/** "Dora" in a row that names its language already; the accent too where a language has two ("Emma · UK"). */
export function tongueChoices(tongue: SpokenTongue): Array<{ value: string; label: string }> {
  const accents = new Set(tongue.choices.map((voice) => voice.language)).size > 1;
  const label = (name: string, language: string): string => (accents ? `${name} · ${language.split("-")[1] ?? language}` : name);
  return [...tongue.choices.map((voice) => ({ value: voice.id, label: label(voice.name, voice.language) })), { value: OFF, label: "Off" }];
}

export function VoiceLanguages({
  settings,
  voice,
  view,
  guard,
}: {
  settings: SettingsStore;
  voice: Pick<VoiceParts, "sample">;
  view: ModelsView;
  guard: PersonOnly;
}) {
  const chosen = useSettings(settings).data.voice;
  const each = chosen.byLanguage !== false;
  const tongues = spokenTongues(chosen, view.voices, chosen.voice ?? view.defaultVoice);
  const spoken = tongues.filter((tongue) => tongue.voice !== null);
  const silent = tongues.filter((tongue) => tongue.voice === null);
  const refused = (id: string) => (guard.refused === id ? { detail: ONLY_YOU } : {});
  const set = (code: TongueCode, to: string | null): void => settings.patch("voice", { voices: withTongue(chosen, code, to) });
  if (tongues.length === 0) return null;
  return (
    <>
      <Setting id="voice/each-language" testID="voice-each-language" {...refused("voice/each-language")}>
        <Switch
          testID="voice-each-language-switch"
          on={each}
          onChange={(next) => guard.mine("voice/each-language", () => settings.patch("voice", { byLanguage: next ? undefined : false }))}
        />
      </Setting>
      {each &&
        spoken.map((tongue) => (
          <Setting key={tongue.code} id={ROWS[tongue.code]} testID={`voice-in-${tongue.code}`} {...refused(ROWS[tongue.code])} stack>
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, flexWrap: "wrap" }}>
              <FoldedChoices
                testID={`voice-in-${tongue.code}-choice`}
                value={tongue.voice ?? OFF}
                options={tongueChoices(tongue)}
                onChange={(id) => guard.mine(ROWS[tongue.code], () => set(tongue.code, id === OFF ? null : id))}
              />
              <MiniButton testID={`voice-in-${tongue.code}-sample`} label="Play a sample" onPress={() => tongue.voice !== null && voice.sample(tongue.voice)} />
            </View>
          </Setting>
        ))}
      {each && silent.length > 0 && (
        <Setting id="voice/add-language" testID="voice-add-language" {...refused("voice/add-language")} stack>
          <FoldedChoices
            testID="voice-add-language-choice"
            value=""
            options={silent.map((tongue) => ({ value: tongue.code, label: tongue.name }))}
            onChange={(code) => {
              const tongue = silent.find((one) => one.code === code);
              // On with the voice that goes with Dashi's.
              if (tongue) guard.mine("voice/add-language", () => set(tongue.code, tongue.pair));
            }}
          />
        </Setting>
      )}
    </>
  );
}
