/**
 * Settings › Voice's rows for talking to Dashi (voice.tsx; decisions.md
 * D147, D148, D150): whether the microphone opens again after Dashi speaks,
 * and whether what is said is planned and waits for a yes before each step.
 * They read and write settings.json `voice`, which the voice loop and the
 * assistant follow live. Only the person's own press changes them.
 */

import { Group } from "../../../shared/cards/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Switch } from "../../ui.tsx";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";

export function TalkRows({ settings, guard }: { settings: SettingsStore; guard: PersonOnly }) {
  const chosen = useSettings(settings).data.voice;
  const refused = (id: string) => (guard.refused === id ? { detail: ONLY_YOU } : {});
  return (
    <Group testID="voice-talk">
      <Setting id="voice/listen-again" testID="voice-listen-again" {...refused("voice/listen-again")}>
        <Switch
          testID="voice-listen-again-switch"
          on={chosen.listenAgain !== false}
          onChange={(next) => guard.mine("voice/listen-again", () => settings.patch("voice", { listenAgain: next ? undefined : false }))}
        />
      </Setting>
      <Setting id="voice/ask-every-step" testID="voice-ask-every-step" {...refused("voice/ask-every-step")}>
        <Switch
          testID="voice-ask-every-step-switch"
          on={chosen.askEveryStep === true}
          onChange={(next) => guard.mine("voice/ask-every-step", () => settings.patch("voice", { askEveryStep: next ? true : undefined }))}
        />
      </Setting>
    </Group>
  );
}
