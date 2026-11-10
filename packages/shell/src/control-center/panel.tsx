/**
 * Control Center (docs/design.html, "Control Center"): a 344-wide panel of
 * tiles in the person's own layout (layout.ts, layout-store.ts), with no
 * header (the date is the menu bar clock's). A tile's page grows out of the
 * tile (page-parts.tsx). Right-click turns the panel into its own editor
 * (edit mode: remove, resize, drag, Add; Cancel throws the session's edits
 * away). From the keyboard: the arrows move between tiles, Space toggles,
 * Return opens, ⇧ and an arrow move a slider, Esc goes back or closes; in
 * edit mode ⌥ and an arrow move the tile, Space resizes it, ⌫ removes it.
 * On a tile's page ↑ and ↓ move between its rows and Space or Return
 * presses one (page-keys.ts), with the same ring.
 */

import { type KeyDownInfo, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import type { BluetoothStore } from "../bluetooth/store.ts";
import type { Laptop } from "../laptop/start.ts";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import { useControlColors, usePanelEdge } from "../shared/controls/palette.ts";
import type { AppMixer } from "../sound/apps/index.ts";
import type { SoundStore } from "../sound/store.ts";
import type { SystemStore } from "../system/store.ts";
import type { WifiStore } from "../wifi/store.ts";
import type { WifiNetwork } from "../wifi/types.ts";
import { type AppletTileSource, isAppletTile } from "./applet-tiles.ts";
import { type ControlPage, isThere } from "./catalog.ts";
import { useControls } from "./controls.tsx";
import type { DeviceStore } from "./devices.ts";
import { frameOf, GRID, type Layout, moveItem, nextSize, pack, removeItem, shown } from "./layout.ts";
import { type LayoutStore, useLayout } from "./layout-store.ts";
import { PanelEditor } from "./lib/edit.tsx";
import { ControlGrid } from "./lib/grid.tsx";
import { PageView } from "./lib/pages.tsx";
import { panelKey } from "./lib/panel-keys.ts";
import { PageKeysContext, PageOrigin, usePageKeys } from "./page-parts.tsx";
import { TILE_RADIUS } from "./tiles.tsx";

export const CONTROL_CENTER_PANEL = { width: GRID.width, padding: GRID.padding, gap: GRID.gap } as const;

export type { ControlPage };

export interface ControlCenterProps {
  flags: FlagsStore;
  devices: DeviceStore;
  system: SystemStore;
  wifi: WifiStore;
  sound: SoundStore;
  /** The apps' sound (sound/apps/): the Sound page's apps and who uses the microphone. */
  mixer?: AppMixer;
  bluetooth: BluetoothStore;
  /** The laptop's power modes, keyboard light and graphics card; their tiles show only on laptops. */
  laptop?: Laptop;
  /** The person's layout, per machine. */
  layout: LayoutStore;
  /** Applets' controls (applets/controls.ts). */
  applets?: AppletTileSource;
  /** The charge limit in percent now; null without one (the battery row's tick). */
  chargeLimit?: () => number | null;
  page: ControlPage;
  onPage: (page: ControlPage) => void;
  /** A network was picked on the Wi-Fi page. */
  onJoin: (network: WifiNetwork) => void;
  onLock: () => void;
  /** The battery row: the battery panel. */
  onBattery?: () => void;
  /** A page's "… Settings": System Settings at that pane. */
  onSettings?: (pane: string) => void;
  onClose: () => void;
  /**
   * Settings › Control Center: the panel as an editor in a window, always
   * editing, in the flow of the page (not on the popover surface). The
   * window's keys reach it as the panel's do; Done saves, and Done, Cancel
   * and Esc close it (`onClose`).
   */
  embedded?: boolean;
}

export function ControlCenterPanel(props: ControlCenterProps) {
  const { page, onPage, onClose, embedded = false } = props;
  const colors = useControlColors();
  const edge = usePanelEdge(GRID.padding);
  const saved = useLayout(props.layout);
  /** The layout being edited; null outside edit mode. */
  const [editDraft, setDraft] = useState<Layout | null>(null);
  // Embedded, the panel is always editing: what is saved until something changes.
  const draft = editDraft ?? (embedded ? saved : null);
  /** The tile the keyboard is on; its ring shows once the keyboard was used. */
  const [focus, setFocus] = useState<string | null>(null);
  /** Where the tile whose page is open was, for the page to grow from. */
  const [origin, setOrigin] = useState<{ left: number; top: number; width: number } | null>(null);
  const controls = useControls(props);
  /** A page's rows by the keyboard (page-parts.tsx `usePageKeys`). */
  const { pageKeys, pageKey } = usePageKeys(page);

  useEffect(() => {
    void props.devices.refresh();
    void props.system.refresh("network");
  }, [props.devices, props.system]);

  const layout = draft ?? saved;
  const here = (id: string): boolean => (isAppletTile(id) ? controls.applet(id) !== undefined : isThere(id, controls.snapshot));
  const placed = pack(shown(layout, here));
  const editing = draft !== null;

  const openPage = (id: string, next: ControlPage): void => {
    const tile = placed.find((each) => each.id === id);
    setOrigin(tile ? frameOf(tile) : null);
    onPage(next);
  };

  const editHandlers = draft
    ? {
        onRemove: (id: string) => setDraft(removeItem(draft, id)),
        onResize: (id: string) => setDraft(nextSize(draft, id, controls.sizesOf(id))),
        onMove: (id: string, over: string) => setDraft(moveItem(draft, id, over)),
      }
    : null;

  const key = (event: KeyDownInfo): void =>
    panelKey({ page, embedded, draft, focus, placed, controls, pageKey, onPage, onClose, setDraft, setFocus, openPage }, event);

  return (
    <View
      occlude
      testID="control-center"
      onWindowKeyDown={key}
      onContextMenu={() => {
        if (page === "main" && !draft) setDraft(saved);
      }}
      style={{
        ...(embedded ? {} : { position: "absolute" as const, right: 8, top: 4 }),
        width: GRID.width,
        flexDirection: "column",
        borderRadius: GRID.radius,
        backgroundColor: colors.surface,
        ...(embedded ? { padding: GRID.padding } : { shadow: "xl" as const, ...edge }),
      }}
    >
      {page !== "main" ? (
        <PageOrigin.Provider value={origin}>
          <PageKeysContext.Provider value={pageKeys}>
            <PageView page={page} props={props} controls={controls} onBack={() => onPage("main")} />
          </PageKeysContext.Provider>
        </PageOrigin.Provider>
      ) : (
        <>
          <ControlGrid
            placed={placed}
            focused={focus}
            editing={editHandlers}
            radiusOf={(id) => (controls.isOn(id) ? TILE_RADIUS.on : TILE_RADIUS.off)}
            renderTile={(tile, frame) => controls.render(tile, frame, editing, (next) => openPage(tile.id, next))}
          />
          {draft && <PanelEditor draft={draft} layout={props.layout} controls={controls} embedded={embedded} setDraft={setDraft} onClose={onClose} />}
        </>
      )}
    </View>
  );
}
