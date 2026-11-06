/**
 * Desktop & Dock: how the Dock looks (the floating Dock or a taskbar across
 * the bottom), whether it hides until the pointer reaches the screen's
 * bottom edge, and whether it is shown at all. All of it is settings.json
 * `dock`, which the shell applies as it changes. Spaces' settings are here
 * too, as on the Mac (settings.json `spaces.switchOnActivate`, and
 * `spaces.fullscreenDesktop`: a full-screen app gets a Desktop of its own).
 */

import { Caption, Group, Page, Setting } from "../ui.tsx";

export function DesktopDockPane() {
  return (
    <Page title="Desktop & Dock">
      <Group testID="dock-settings">
        <Setting id="desktop-dock/style" control="dock-style" />
        <Setting id="desktop-dock/autohide" control="dock-autohide" />
        <Setting id="desktop-dock/show-dock" control="dock-visible" />
      </Group>
      <Caption keys="⌥❖D">Hiding is also in the Dock's right-click menu, and on</Caption>
      <Group testID="spaces-settings">
        <Setting id="desktop-dock/go-to-app-desktop" control="spaces-switch-on-activate" />
        <Setting id="desktop-dock/full-screen-desktop" control="spaces-fullscreen-desktop" />
      </Group>
      <Caption>Move between desktops with ⌃← and ⌃→, jump with ⌃1 to ⌃9, or swipe sideways with three fingers. Overview (⌃↑) shows them all.</Caption>
    </Page>
  );
}
