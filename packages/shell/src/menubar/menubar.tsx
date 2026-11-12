/**
 * The menu bar: the Dashi menu and the focused app's name and menus on the
 * left, status and the clock on the right. A click opens a title's menu (the
 * pointer then moves between menus without clicking), a click on the status
 * area opens Control Center (the battery has its own panel), and a click on
 * the clock the notification center (menus/). Programs' own items, tray
 * icons and applets, sit left of the status glyphs (extras/), then the agent
 * mark (agent-mark.tsx), the person's own recording, and the microphone
 * while an app records from it (sound/mic-pill.tsx). An app that
 * published its own menus (app-menus/) has them here while one of its
 * windows is focused, in place of File, Edit, and View. The bar is one row:
 * when the status side runs out of room, its items go into "…"
 * (menubar-status.tsx), never the menus.
 */

import { LOGO, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { type AppMenuStore, useAppMenus } from "../app-menus/index.ts";
import { type BarMenuId, barMenus, titleStop, useMenus } from "../menus/index.ts";
import type { App } from "../shared/apps/index.ts";
import type { ToplevelStore } from "../toplevels.ts";
import { statusRoom } from "./lib/menubar-fit.ts";
import { Title } from "./lib/menubar-items.tsx";
import { titleLabel, useBarStops } from "./lib/menubar-keys.ts";
import { useBarName } from "./lib/menubar-name.ts";
import { type StatusSources, useStatusSlots } from "./lib/menubar-program-slots.tsx";
import { StatusSide } from "./lib/menubar-status.tsx";

export interface MenuBarProps extends StatusSources {
  apps: readonly App[];
  toplevels: ToplevelStore;
  /** The menus apps published; the focused app's replace File, Edit, and View. */
  appMenus: AppMenuStore;
  /** The installed app a window's app id stands for (the Dock's match), for its name. */
  installed?: (appId: string) => App | undefined;
}

export function MenuBar(props: MenuBarProps) {
  const { apps, toplevels, menus, appMenus, output, installed, accessible = () => false } = props;
  const colors = useColors();
  const label = { fontSize: 13, color: colors.text } as const;
  const { popover: current, appName: frozenName, output: openOn, bar: ring } = useMenus(menus);
  // Only the bar the popover opened from shows it as open, and the keyboard's ring.
  const popover = openOn === output ? current : null;
  const focused = openOn === output ? (ring ?? null) : null;
  // The room the menus leave the status side: the bar's width and the menus' (both measured).
  const [barWidth, setBarWidth] = useState<number | null>(null);
  const [menusWidth, setMenusWidth] = useState<number | null>(null);
  const appName = useBarName(apps, toplevels, installed, frozenName);
  const openMenu = popover?.kind === "menu" ? popover.id : null;
  // Held while a popover is open, like the name (app-menus/store.ts).
  const titles = barMenus(useAppMenus(appMenus));
  const { titleBounds, statusStops } = useBarStops(menus, output, appName, titles);
  const slots = useStatusSlots(props, popover, appName, barWidth);
  const menu = (id: BarMenuId, children: ReactNode) => (
    <Title
      key={id}
      id={id}
      open={openMenu === id}
      focused={focused === titleStop(id)}
      {...(accessible() && id === "dashi" ? { label: titleLabel(id, appName, titles) } : {})}
      onOpen={(x) => void menus.toggleMenu(id, x, appName, output)}
      onHover={(x) => menus.hoverMenu(id, x, output)}
      onBounds={(bounds) => titleBounds.current.set(id, bounds)}
    >
      {children}
    </Title>
  );

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 6,
        // The clock's pill has 8 of its own.
        paddingRight: 6,
        position: "relative",
        backgroundColor: colors.menuBar,
      }}
    >
      {/* A hairline, not a shadow: a shadow needs a surface taller than the bar, and that would take clicks from the windows' top edge. */}
      {/* It spans the bar, so it says the bar's width too (Metal reports a root's children's layout, not the root's). */}
      <View
        testID="menu-bar-edge"
        onLayout={(bounds) => setBarWidth(bounds.width)}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.menuBarEdge }}
      />
      {/* The app's menus never give way: the status side does (menubar-fit.ts). */}
      <View testID="menu-titles" onLayout={(bounds) => setMenusWidth(bounds.width)} style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
        {menu("dashi", <Svg markup={LOGO} size={16} color={colors.text} />)}
        {menu(
          "app",
          <Text numberOfLines={1} style={{ ...label, fontWeight: "bold" }}>
            {appName}
          </Text>,
        )}
        {titles.map(({ id, title }) =>
          menu(
            id,
            <Text numberOfLines={1} style={label}>
              {title}
            </Text>,
          ),
        )}
      </View>
      <StatusSide
        slots={slots}
        room={barWidth === null || menusWidth === null ? null : statusRoom(barWidth, menusWidth, 12)}
        areaOpen={popover?.kind === "control-center"}
        moreOpen={popover?.kind === "overflow"}
        onMore={(right, hidden) => void menus.toggleOverflow(appName, right, hidden, output)}
        onHidden={(hidden) => {
          if (popover?.kind === "overflow") menus.setOverflow(hidden);
        }}
        focused={focused}
        onStops={(stops) => {
          statusStops.current = stops;
        }}
        accessible={accessible()}
      />
    </View>
  );
}
