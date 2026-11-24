/**
 * Lock screen: locking now, and when the screens go dark by themselves,
 * which is set in one place, Battery & power, beside sleep (this row says
 * what it is, and links there by the pane's name: SE-14).
 */

import { TextLink } from "@dashi/ui";
import { Button, Caption, Group } from "../../../shared/cards/index.ts";
import { paneTitle } from "../../../shared/settings/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page } from "../../ui.tsx";
import { BLANK_CHOICES, blankChoice, DEFAULT_BLANK_AFTER } from "../controls.ts";
import { Setting } from "../setting.tsx";

/** "After 5 minutes", or "Never". */
export function blankWords(seconds: number): string {
  const choice = BLANK_CHOICES.find((each) => each.value === blankChoice(seconds));
  return seconds === 0 || !choice ? "Never" : `After ${choice.label}`;
}

export function LockScreenPane({ settings, lock, show }: { settings: SettingsStore; lock: () => void; show: (pane: "battery", row: string) => void }) {
  const { idle } = useSettings(settings).data;
  const seconds = idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER;
  return (
    <Page title={paneTitle("lock-screen")}>
      <Group>
        <Setting id="lock-screen/lock-now">
          <Button testID="lock-now" label="Lock" primary onPress={lock} />
        </Setting>
        <Setting id="lock-screen/turn-display-off" detail={`${blankWords(seconds)}. Set in ${paneTitle("battery")}, beside sleep.`}>
          <TextLink look="panel" testID="lock-blank" label={paneTitle("battery")} onPress={() => show("battery", "turn-display-off")} />
        </Setting>
      </Group>
      <Caption keys="⌃❖Q">Locking is also in the Dashi menu, and on</Caption>
    </Page>
  );
}
