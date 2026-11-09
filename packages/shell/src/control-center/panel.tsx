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
import { useControlColors, usePanelEdge } from "../shared/controls/palette.ts";
import { stepLevel } from "../shared/controls/slider-math.ts";
import type { AppMixer } from "../sound/apps/index.ts";
import type { SoundStore } from "../sound/store.ts";
import type { SystemStore } from "../system/store.ts";
import type { WifiStore } from "../wifi/store.ts";
import type { WifiNetwork } from "../wifi/types.ts";
import { type AppletTileSource, isAppletTile } from "./applet-tiles.ts";
import { type ControlPage, DEFAULT_LAYOUT, isThere } from "./catalog.ts";
import { useControls } from "./controls.tsx";
import type { DeviceStore } from "./devices.ts";
import { AddList, EditFooter } from "./edit.tsx";
import type { FlagsStore } from "./flags.ts";
import { ControlGrid } from "./grid.tsx";
import { addItem, type Direction, frameOf, GRID, type Layout, moveItem, moveToward, neighbor, nextSize, pack, removeItem, shown } from "./layout.ts";
import { type LayoutStore, useLayout } from "./layout-store.ts";
import { PageKeysContext, PageOrigin, usePageKeys } from "./page-parts.tsx";
import { PageView } from "./pages.tsx";
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

const ARROWS: Readonly<Record<string, Direction>> = { left: "left", right: "right", up: "up", down: "down" };

export function ControlCenterPanel(props: ControlCenterProps) {
  const { page, onPage, onClose, embedded = false } = props;
  const colors = useControlColors();
  const edge = usePanelEdge();
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

  const addable = editing ? controls.addable(layout) : [];

  const key = (event: KeyDownInfo): void => {
    const name = event.key;
    if (name === "escape") {
      if (page !== "main") return onPage("main");
      // Embedded, Esc is Cancel: the edits go and the editor closes.
      if (embedded) {
        setDraft(null);
        return onClose();
      }
      if (draft) return setDraft(null);
      return onClose();
    }
    if (page !== "main") return pageKey(name);
    const direction = ARROWS[name];
    if (direction) {
      if (focus === null) return setFocus(placed[0]?.id ?? null);
      if (draft && event.alt) return setDraft(moveToward(draft, placed, focus, direction));
      if (event.shift && !draft) {
        const level = controls.levelOf(focus);
        if (level !== null) return controls.setLevel(focus, stepLevel(level, direction));
      }
      setFocus(neighbor(placed, focus, direction) ?? focus);
      return;
    }
    if (focus === null) return;
    if (draft) {
      if (name === "space" || name === "enter") setDraft(nextSize(draft, focus, controls.sizesOf(focus)));
      if (name === "backspace" || name === "delete") setDraft(removeItem(draft, focus));
      return;
    }
    if (name === "space") controls.press(focus, (next) => openPage(focus, next));
    if (name === "enter") controls.open(focus, (next) => openPage(focus, next));
  };

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
        padding: GRID.padding,
        borderRadius: GRID.radius,
        backgroundColor: colors.surface,
        ...(embedded ? {} : { shadow: "xl" as const, ...edge }),
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
          {draft && (
            <>
              <AddList entries={addable} onAdd={(id) => setDraft(addItem(draft, id, controls.sizesOf(id)[0] ?? "round"))} />
              <EditFooter
                onReset={() => setDraft(DEFAULT_LAYOUT)}
                onCancel={() => {
                  setDraft(null);
                  if (embedded) onClose();
                }}
                onDone={() => {
                  props.layout.set(draft);
                  setDraft(null);
                  if (embedded) onClose();
                }}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
