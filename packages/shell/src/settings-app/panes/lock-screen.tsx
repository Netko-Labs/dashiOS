/** Lock Screen: when the screens go dark by themselves, and locking now. */

import { BLANK_CHOICES, blankChoice } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Page, Row } from "../ui.tsx";

export function LockScreenPane({ settings, lock }: { settings: SettingsStore; lock: () => void }) {
  const { idle } = useSettings(settings).data;
  const seconds = idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER;
  return (
    <Page title="Lock Screen">
      <Group>
        <Row
          stack
          label="Turn display off after"
          detail="The screens go dark when you have been away this long. Moving the pointer or pressing a key wakes them."
        >
          <Choices
            testID="lock-blank"
            options={BLANK_CHOICES}
            value={blankChoice(seconds)}
            onChange={(blankAfterSeconds) => settings.patch("idle", { blankAfterSeconds })}
          />
        </Row>
        <Row label="Lock Screen" detail="Covers the screen until you type your password.">
          <Button testID="lock-now" label="Lock Screen" onPress={lock} />
        </Row>
      </Group>
      <Caption keys="⌃❖Q">Locking is also in the Dashi menu, and on</Caption>
    </Page>
  );
}
