/**
 * Desktop & Dock: how the Dock looks (the floating Dock or a taskbar across
 * the bottom), whether it hides until the pointer reaches the screen's
 * bottom edge, and whether it is shown at all. All of it is settings.json
 * `dock`, which the shell applies as it changes. Spaces' settings are here
 * too, as on the Mac (settings.json `spaces.switchOnActivate`, and
 * `spaces.fullscreenDesktop`: a full-screen app gets a Desktop of its own).
 */

import { Switch } from "@dashi/ui";
import { resolveDock } from "../../dock/settings.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row, Spot } from "../ui.tsx";

export function DesktopDockPane({ settings }: { settings: SettingsStore }) {
  const data = useSettings(settings).data;
  const dock = resolveDock(data.dock);
  const switchOnActivate = data.spaces.switchOnActivate ?? true;
  const fullscreenDesktop = data.spaces.fullscreenDesktop ?? true;
  return (
    <Page title="Desktop & Dock">
      <Group testID="dock-settings">
        <Spot pane="desktop-dock" row="style">
          <Row stack label="Style" detail="The Dock floats above the bottom edge; the taskbar fills it, with a button for each window.">
            <Choices
              testID="dock-style"
              value={dock.style}
              options={[
                { value: "dock", label: "Dock" },
                { value: "taskbar", label: "Taskbar" },
              ]}
              onChange={(style) => settings.patch("dock", { style })}
            />
          </Row>
        </Spot>
        <Spot pane="desktop-dock" row="autohide">
          <Row
            label="Automatically hide and show"
            detail="The Dock slides away and gives its room back to windows. Push the pointer against the bottom edge to bring it back."
          >
            <Switch testID="dock-autohide" on={dock.autohide} onChange={(autohide) => settings.patch("dock", { autohide })} />
          </Row>
        </Spot>
        <Row label="Show the Dock" detail="Turned off, there is no Dock at all.">
          <Switch testID="dock-visible" on={dock.visible} onChange={(visible) => settings.patch("dock", { visible })} />
        </Row>
      </Group>
      <Caption keys="⌥❖D">Hiding is also in the Dock's right-click menu, and on</Caption>
      <Group testID="spaces-settings">
        <Row label="Go to an app's desktop" detail="Opening an app goes to the desktop its window is on, instead of bringing the window to you.">
          <Switch testID="spaces-switch-on-activate" on={switchOnActivate} onChange={(on) => settings.patch("spaces", { switchOnActivate: on })} />
        </Row>
        <Row
          label="Give full-screen apps their own desktop"
          detail="A game or video in full screen gets a desktop next to yours, and comes back when it leaves."
        >
          <Switch testID="spaces-fullscreen-desktop" on={fullscreenDesktop} onChange={(on) => settings.patch("spaces", { fullscreenDesktop: on })} />
        </Row>
      </Group>
      <Caption>Move between desktops with ⌃← and ⌃→, jump with ⌃1 to ⌃9, or swipe sideways with three fingers. Overview (⌃↑) shows them all.</Caption>
    </Page>
  );
}
