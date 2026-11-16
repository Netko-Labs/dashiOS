/**
 * Settings › Voice's rows for talking to Dashi (voice.tsx; decisions.md
 * D147, D150): whether the microphone opens again after Dashi speaks.
 * ("Ask before every step" went with plans, decisions.md D261.)
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
    </Group>
  );
}
