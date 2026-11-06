/** Lock Screen: when the screens go dark by themselves, and locking now. */

import { BLANK_CHOICES, blankChoice } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Page, Setting } from "../ui.tsx";

export function LockScreenPane({ settings, lock }: { settings: SettingsStore; lock: () => void }) {
  const { idle } = useSettings(settings).data;
  const seconds = idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER;
  return (
    <Page title="Lock Screen">
      <Group>
        <Setting id="lock-screen/turn-display-off">
          <Choices
            testID="lock-blank"
            options={BLANK_CHOICES}
            value={blankChoice(seconds)}
            onChange={(blankAfterSeconds) => settings.patch("idle", { blankAfterSeconds })}
          />
        </Setting>
        <Setting id="lock-screen/lock-now">
          <Button testID="lock-now" label="Lock Screen" onPress={lock} />
        </Setting>
      </Group>
      <Caption keys="⌃❖Q">Locking is also in the Dashi menu, and on</Caption>
    </Page>
  );
}
