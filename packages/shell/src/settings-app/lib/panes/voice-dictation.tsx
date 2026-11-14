/**
 * Settings › Voice's dictation rows (voice.tsx): whether the dictation key
 * types what is said, which key it is, hands-free, and tidying. They read
 * and write settings.json `dictation`, which dictation follows live
 * (boot/dictation.ts). Only the person's own press changes them.
 */

import { DICTATION_KEY_LABELS } from "../../../dictation/index.ts";
import { Group } from "../../../shared/cards/index.ts";
import { FoldedChoices } from "../../../shared/controls/folded.tsx";
import { DICTATION_KEYS, isDictationKeyId } from "../../../shared/pill/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Switch } from "../../ui.tsx";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";

const KEY_OPTIONS = DICTATION_KEYS.map((id) => ({ value: id, label: id === "auto" ? "Automatic (right ⌥, or Caps Lock)" : DICTATION_KEY_LABELS[id] }));

export function DictationRows({ settings, guard }: { settings: SettingsStore; guard: PersonOnly }) {
  const chosen = useSettings(settings).data.dictation;
  const on = chosen.on !== false;
  const key = isDictationKeyId(chosen.key) ? chosen.key : "auto";
  const refused = (id: string) => (guard.refused === id ? { detail: ONLY_YOU } : {});
  return (
    <Group testID="voice-dictation">
      <Setting id="voice/dictation" testID="voice-dictation-on" {...refused("voice/dictation")}>
        <Switch
          testID="voice-dictation-switch"
          on={on}
          onChange={(next) =>
            next ? guard.mine("voice/dictation", () => settings.patch("dictation", { on: undefined })) : settings.patch("dictation", { on: false })
          }
        />
      </Setting>
      {on && (
        <Setting id="voice/dictation-key" testID="voice-dictation-key" {...refused("voice/dictation-key")} stack>
          <FoldedChoices
            testID="voice-dictation-key-choice"
            value={key}
            options={KEY_OPTIONS}
            onChange={(id) => guard.mine("voice/dictation-key", () => settings.patch("dictation", { key: id === "auto" ? undefined : id }))}
          />
        </Setting>
      )}
      {on && (
        <Setting id="voice/hands-free" testID="voice-hands-free" {...refused("voice/hands-free")}>
          <Switch
            testID="voice-hands-free-switch"
            on={chosen.handsFree !== false}
            onChange={(next) => guard.mine("voice/hands-free", () => settings.patch("dictation", { handsFree: next ? undefined : false }))}
          />
        </Setting>
      )}
      {on && (
        <Setting id="voice/tidy" testID="voice-tidy" {...refused("voice/tidy")}>
          <Switch
            testID="voice-tidy-switch"
            on={chosen.tidy !== false}
            onChange={(next) => guard.mine("voice/tidy", () => settings.patch("dictation", { tidy: next ? undefined : false }))}
          />
        </Setting>
      )}
    </Group>
  );
}
