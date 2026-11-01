/** Notifications: Do Not Disturb, the same switch as in Control Center. */

import { type FlagsStore, useFlags } from "../../control-center/flags.ts";
import { Switch } from "../../wifi/switch.tsx";
import { Caption, Group, Page, Row } from "../ui.tsx";

export function NotificationsPane({ flags }: { flags: FlagsStore }) {
  const { dnd } = useFlags(flags);
  return (
    <Page title="Notifications">
      <Group>
        <Row label="Do Not Disturb" detail="Banners are held back until you turn it off; they wait in the notification center.">
          <Switch testID="notifications-dnd" on={dnd} onChange={(on) => flags.set({ dnd: on })} />
        </Row>
      </Group>
      <Caption>Do Not Disturb is the same switch as in Control Center.</Caption>
    </Page>
  );
}
