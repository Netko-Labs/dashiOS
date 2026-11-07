/** Notifications: Do Not Disturb, the same switch as in Control Center. */

import { Caption, Group, Page, Setting } from "../ui.tsx";

export function NotificationsPane() {
  return (
    <Page title="Notifications">
      <Group>
        <Setting id="notifications/do-not-disturb" control="notifications-dnd" />
      </Group>
      <Caption>Do Not Disturb is the same switch as in Control Center.</Caption>
    </Page>
  );
}
