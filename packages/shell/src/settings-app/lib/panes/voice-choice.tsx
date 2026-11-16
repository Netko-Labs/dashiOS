/**
 * Settings › Voice's model choices (decisions.md D200): the recogniser that hears (Parakeet, or Whisper where its set is
 * here) and what corrects dictation after the rules (SpeakoFlow Mini, Gemma 4 E2B, the rules alone, or Claude with the
 * person's key). Each says its size, its licence and what it was measured to do, so the person can try them. A model
 * on this computer is fetched by the row under it (voice.tsx `Corrections`). Only the person's own press changes them.
 */

import { CORRECTION_CHOICES, type CorrectionChoice, isCorrectionChoice } from "../../../rewrite/index.ts";
import { Group, Note } from "../../../shared/cards/index.ts";
import { FoldedChoices } from "../../../shared/controls/folded.tsx";
import { isRecognizer, RECOGNIZERS, type Recognizer } from "../../../voice/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { CORRECTION_LABELS, CORRECTION_LINES, RECOGNIZER_LABELS, RECOGNIZER_LINES } from "./voice-words.ts";

export function ModelChoiceRows({ settings, guard, whisperHere }: { settings: SettingsStore; guard: PersonOnly; whisperHere: boolean }) {
  const data = useSettings(settings).data;
  const recognizer: Recognizer = isRecognizer(data.voice.recognizer) ? data.voice.recognizer : "parakeet";
  const corrections: CorrectionChoice = isCorrectionChoice(data.dictation.corrections) ? data.dictation.corrections : "speakoflow";
  const refused = (id: string) => (guard.refused === id ? { detail: ONLY_YOU } : {});
  return (
    <Group testID="voice-models-choice">
      <Setting id="voice/recognizer" testID="voice-recognizer" {...refused("voice/recognizer")}>
        <FoldedChoices
          testID="voice-recognizer-choice"
          value={recognizer}
          options={RECOGNIZERS.map((value) => ({ value, label: RECOGNIZER_LABELS[value] }))}
          onChange={(next) => guard.mine("voice/recognizer", () => settings.patch("voice", { recognizer: next === "parakeet" ? undefined : next }))}
        />
      </Setting>
      <Note testID="voice-recognizer-line">{`${RECOGNIZER_LINES[recognizer]}${recognizer === "whisper" && !whisperHere ? " Fetch More languages, below, first: until then Parakeet hears." : ""}`}</Note>
      <Setting id="voice/corrections-model" testID="voice-corrections-model" {...refused("voice/corrections-model")}>
        <FoldedChoices
          testID="voice-corrections-model-choice"
          value={corrections}
          options={CORRECTION_CHOICES.map((value) => ({ value, label: CORRECTION_LABELS[value] }))}
          onChange={(next) =>
            guard.mine("voice/corrections-model", () => settings.patch("dictation", { corrections: next === "speakoflow" ? undefined : next }))
          }
        />
      </Setting>
      <Note testID="voice-corrections-model-line">{CORRECTION_LINES[corrections]}</Note>
    </Group>
  );
}
