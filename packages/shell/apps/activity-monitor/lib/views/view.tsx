/**
 * Activity Monitor's window, as layout only: one toolbar row (Quit…, the view
 * button, the CPU / Memory / Energy / Disk / Network tabs, search), the table
 * of apps (each with its processes under a disclosure) or of every process,
 * and the summary strip for the open tab, which View › Show Summary hides; a
 * sheet or menu opens over it. The state is use-monitor-window.ts (composed
 * from use-keyboard-owner.ts, use-listing.ts, use-sheets.ts and use-keys.ts),
 * the toolbar is toolbar.tsx, the body content.tsx, the overlay overlay.tsx.
 *
 * The person's own apps and processes can be quit after a sheet asks;
 * everyone else's are shown dimmed and read-only. Nothing typed quits
 * anything: Return in the search selects, and the quit sheet has no Return
 * default. A quit app still running after a few seconds is offered a force
 * quit. The selection is a line's key (an app or a pid), not a place in the
 * list, and the rows hold still while the pointer is over them and just
 * after a line is chosen (the Table's `steady`). The list has the keyboard until the person clicks the
 * search field or presses ❖F, and takes it back when they click a row: there the
 * arrows move the selection, ← and → close and open an app, Return or a
 * double click inspects, and a right click offers the same commands. The
 * field's ↑ and ↓ move the selection too, and its Return selects and hands
 * the keyboard to the list. The battery menu
 * opens it at Energy with an app selected (args.ts, `onOpen`).
 */

import { AppWindow } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { MonitorActions } from "../actions.ts";
import type { OpenRequest } from "../args.ts";
import { useMonitorWindow } from "../hooks/use-monitor-window.ts";
import type { Monitor } from "../monitor.ts";
import { MonitorContent } from "./content.tsx";
import { monitorOverlay } from "./overlay.tsx";
import { Sized } from "./sized.tsx";
import { MonitorBar } from "./toolbar.tsx";

export function MonitorWindow({ monitor, actions, initial = {} }: { monitor: Monitor; actions: MonitorActions; initial?: OpenRequest }) {
  const model = useMonitorWindow(monitor, actions, initial);
  return (
    // One chrome row: the scope is the view button's own label, and the summary is content under the table.
    <Sized onSize={model.onSize}>
      <AppWindow
        title="Activity Monitor"
        // In a narrow window the title gives its room to the controls first (toolbar-fit.ts).
        {...(model.fit.title ? {} : { center: <View style={{ flex: 1 }} /> })}
        toolbar={<MonitorBar model={model} />}
        overlay={monitorOverlay(model)}
      >
        <MonitorContent model={model} />
      </AppWindow>
    </Sized>
  );
}
