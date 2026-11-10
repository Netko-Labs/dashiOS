/**
 * The Activity Monitor's overlay: the one sheet or menu open over the window
 * (the quit sheet, its "still running" follow-up, the refusal, the inspect
 * sheet, the view menu, or a right click's context menu). None open is no
 * overlay at all, so the window draws nothing over its content.
 */

import type { ReactNode } from "react";
import { factsRoom, InspectSheet, QuitSheet, RefusedSheet, StillRunningSheet } from "./sheets.tsx";
import type { MonitorModel } from "./use-monitor-window.ts";
import { ContextMenu, ViewMenu } from "./view-menus.tsx";

export function monitorOverlay(model: MonitorModel): ReactNode | undefined {
  const { actions, state, size, insetTop, view, setView, listing, sheets } = model;
  const { sheet, menu } = sheets;
  const { selectedLine } = listing;
  return sheet?.kind === "quit" ? (
    <QuitSheet line={sheet.line} onAnswer={(signal) => sheets.answer(sheet.line, signal)} />
  ) : sheet?.kind === "still" ? (
    <StillRunningSheet name={sheet.line.name} onAnswer={(force) => (force ? sheets.answer(sheet.line, "SIGKILL") : sheets.closeSheet())} />
  ) : sheet?.kind === "refused" ? (
    <RefusedSheet name={sheet.name} reason={sheet.reason} onClose={sheets.closeSheet} />
  ) : sheet?.kind === "inspect" ? (
    <InspectSheet
      // Its numbers go on with the list's while it is open.
      line={listing.lines.find((line) => line.key === sheet.line.key) ?? sheet.line}
      parentName={state.rows.find((row) => row.pid === sheet.line.process?.ppid)?.name ?? null}
      onClose={sheets.closeSheet}
      maxFacts={factsRoom(size.height, Math.max(insetTop, 0), sheet.line.kind === "app" && sheet.line.members.length > 1)}
    />
  ) : menu?.kind === "view" ? (
    <ViewMenu x={menu.x} y={menu.y} view={view} onChange={(patch) => setView({ ...view, ...patch })} onClose={sheets.closeMenu} />
  ) : menu?.kind === "context" && selectedLine ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      line={selectedLine}
      canQuit={sheets.refusal === null}
      onInspect={() => sheets.inspect()}
      onQuit={() => sheets.quit()}
      onToggle={() => listing.toggle(selectedLine.key.slice(4))}
      onCopy={(text) => actions.copy(text)}
      onClose={sheets.closeMenu}
    />
  ) : undefined;
}
