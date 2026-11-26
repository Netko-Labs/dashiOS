/**
 * The Dock's panel (DK-1): thin glass, radius `GLASS.dock.radius`, the rim
 * and hairline the compositor draws round it; the kept apps, then the ones
 * running that aren't, then minimized windows, then the Trash (DK-4), a
 * 1 pt divider between each group. A card that asks rings it amber and dims
 * the icons (sign.ts). Each icon reports the pointer coming onto it, for the
 * label and magnification (view.tsx keeps which one).
 */

import { Frosted, GLASS } from "@dashi/ui";
import type { Bounds, PointerInfo } from "@mirinjs/metal";
import { type ReactNode, useSyncExternalStore } from "react";
import { iconPath } from "../../shared/apps/index.ts";
import { DOCK } from "../../theme.ts";
import { type Badge, badgeFor } from "../badges.ts";
import type { DockEntry, MinimizedEntry } from "../layout.ts";
import { ASK_RIM, dockSign } from "../sign.ts";
import type { TileStore } from "../tiles.ts";
import { Divider, DockIcon } from "./icon.tsx";
import { magnified } from "./magnify.ts";
import { iconRise, panelOpacity, type SlideState } from "./slide.tsx";

/** The Trash's key among the Dock's icons. */
export const TRASH_KEY = "dock:trash";

/** The icon under the pointer: its key, its place in the row (dividers left out), its name and its bounds. */
export interface Hovered {
  key: string;
  index: number;
  name: string;
  bounds: Bounds | null;
}

export interface DockPanelProps {
  /** The kept apps, in the order they show now (a dragged one moved). */
  pinned: readonly DockEntry[];
  running: readonly DockEntry[];
  minimized: readonly MinimizedEntry[];
  slid: SlideState;
  starting: ReadonlySet<string>;
  wanting: ReadonlySet<string>;
  badges: ReadonlyMap<string, Badge>;
  /** The Trash: whether it is full; null leaves it out (the taskbar has none). */
  trash: { full: boolean } | null;
  /** The icon magnification grows round (magnify.ts); null: none. */
  magnifyAt: number | null;
  opacityOf(key: string): number;
  tiles: Pick<TileStore, "set"> | null;
  onPanel?: (bounds: Bounds) => void;
  onHover(hovered: Hovered | null, key: string): void;
  onPress(entry: DockEntry): void;
  onPointer(entry: DockEntry, place: number | null, centerX: number, event: PointerInfo): void;
  onMenu(key: string, centerX: number): void;
  onOptions(x: number): void;
  onRestore(id: number): void;
  onTrash(): void;
  onTrashMenu(centerX: number): void;
  onTrashDrop(paths: readonly string[]): void;
}

/** The ids a Dock entry's badge may be filed under: its key, and the app id it was started from. */
const badgeIds = (entry: DockEntry): string[] => [entry.key, entry.app.id].filter((id): id is string => typeof id === "string" && id !== "");

export function DockPanel(props: DockPanelProps) {
  // A card asks (sign.ts): the icons dim under an amber rim, a sign no window can draw.
  const asking = useSyncExternalStore(dockSign.asking.subscribe, dockSign.asking.getSnapshot);
  const dim = asking ? ASK_RIM.dim : 1;
  const { pinned, running, minimized, slid, tiles } = props;
  const hover = (key: string, index: number, name: string) => (hovered: boolean, bounds?: Bounds) =>
    props.onHover(hovered ? { key, index, name, bounds: bounds ?? null } : null, key);
  const look = (index: number) => ({ magnified: magnified(index, props.magnifyAt), rise: iconRise(slid.rise, index) });
  const entryIcon = (entry: DockEntry, index: number, place: number | null, opacity: number) => (
    <DockIcon
      key={entry.key}
      label={entry.app.name}
      icon={entry.app.icon}
      running={place === null || entry.windows.length > 0 || props.starting.has(entry.key)}
      attention={props.wanting.has(entry.key)}
      badge={badgeFor(props.badges, ...badgeIds(entry))}
      opacity={opacity}
      onPress={() => props.onPress(entry)}
      onPointer={(event, centerX) => props.onPointer(entry, place, centerX, event)}
      onMenu={(centerX) => props.onMenu(entry.key, centerX)}
      onTile={(bounds) => tiles?.set(entry.key, bounds)}
      onHover={hover(entry.key, index, entry.app.name)}
      {...look(index)}
      testID={`dock-${entry.app.name}`}
    />
  );
  const trashAt = pinned.length + running.length + minimized.length;
  return (
    <PanelGlass asking={asking} slid={slid} onPanel={props.onPanel} onOptions={props.onOptions}>
      {pinned.map((entry, index) => entryIcon(entry, index, index, props.opacityOf(entry.key) * dim))}
      {running.length > 0 && <Divider />}
      {running.map((entry, index) => entryIcon(entry, pinned.length + index, null, dim))}
      {minimized.length > 0 && <Divider />}
      {minimized.map(({ window, app }, at) => {
        const index = pinned.length + running.length + at;
        const label = window.title ? `${app.name}: ${window.title}` : app.name;
        return (
          <DockIcon
            key={`minimized:${window.id}`}
            label={label}
            icon={app.icon}
            running={false}
            opacity={0.82 * dim}
            onPress={() => props.onRestore(window.id)}
            onHover={hover(`minimized:${window.id}`, index, label)}
            {...look(index)}
            testID={`dock-minimized-${window.id}`}
          />
        );
      })}
      {props.trash && <Divider />}
      {props.trash && (
        <DockIcon
          label="Trash"
          icon={iconPath(props.trash.full ? "trash-full" : "trash")}
          running={false}
          opacity={dim}
          onPress={props.onTrash}
          onMenu={props.onTrashMenu}
          onDrop={props.onTrashDrop}
          onHover={hover(TRASH_KEY, trashAt, "Trash")}
          {...look(trashAt)}
          testID="dock-trash"
        />
      )}
    </PanelGlass>
  );
}

/** The panel itself: thin glass round the row, amber while a card asks. */
function PanelGlass({
  asking,
  slid,
  onPanel,
  onOptions,
  children,
}: {
  asking: boolean;
  slid: SlideState;
  onPanel?: ((bounds: Bounds) => void) | undefined;
  onOptions(x: number): void;
  children: ReactNode;
}) {
  return (
    <Frosted
      level="thin"
      testID="dock-panel"
      onContextMenu={(event) => onOptions(event.x)}
      {...(onPanel ? { onLayout: onPanel } : {})}
      // Past the Dock's edge Metal reports nothing more, not even the release.
      style={{
        opacity: panelOpacity(slid),
        flexDirection: "row",
        alignItems: "flex-start",
        gap: DOCK.gap,
        paddingLeft: DOCK.paddingX,
        paddingRight: DOCK.paddingX,
        paddingTop: DOCK.paddingTop,
        paddingBottom: DOCK.paddingBottom,
        borderRadius: GLASS.dock.radius,
        // The rim and hairline are the glass's own; only a card asking draws an edge (CP-7).
        ...(asking ? { borderWidth: ASK_RIM.width, borderColor: ASK_RIM.color } : {}),
      }}
    >
      {children}
    </Frosted>
  );
}
