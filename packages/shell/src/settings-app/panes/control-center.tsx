/**
 * Settings › Control Center: the same editor the panel turns into on a
 * right-click (control-center/panel.tsx, embedded): remove a tile with its
 * "−", click it to switch its size, drag to move it, add from the list under
 * it (applets' controls under their applet's name), then Done; Cancel throws
 * the edits away and Reset puts the default back. The layout is this
 * machine's (control-center/layout-store.ts), so the panel follows at once.
 */

import { View } from "@mirinjs/metal";
import { ControlCenterPanel, type ControlCenterProps } from "../../control-center/index.ts";
import { Caption, Page } from "../ui.tsx";

export type ControlCenterEditor = Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "embedded">;

export function ControlCenterPane({ editor }: { editor: ControlCenterEditor | null }) {
  return (
    <Page title="Control Center">
      <Caption>Right-click Control Center to edit it in place. Tiles for what this computer lacks are left out, and come back where they were.</Caption>
      {editor && (
        <View testID="control-center-editor" style={{ alignItems: "center", paddingTop: 8 }}>
          <ControlCenterPanel {...editor} embedded page="main" onPage={() => {}} onClose={() => {}} />
        </View>
      )}
    </Page>
  );
}
