/**
 * sign_in, fill_code and pay on an element of a browser tab (`ref`), through
 * Dashi's extension: the extension focuses the field and says what it is now
 * (a real password field by its type, or an editable text field) and the
 * addresses of every document around it; field-check.ts decides as it does
 * for accessibility's answer; Dashi then types the secret itself with the
 * agent's hands into the browser's window, as it does elsewhere. The secret
 * never goes through the extension, and read_page says the field is filled.
 */

import type { BrowserLink } from "../../../browser/bridge.ts";
import { type FieldReport, parseField, type TabInfo } from "../../../browser/protocol.ts";
import type { CompositorWindow } from "../../../compositor.ts";
import type { Focused, Placed, Rect } from "../../atspi/index.ts";
import type { RunContext, ToolResult } from "../../context.ts";
import { toolError } from "../../context.ts";
import type { FieldInfo } from "../../secrets/index.ts";
import { chooseTab, NO_EXTENSION } from "../browser.ts";

/** The browser's window that shows `tab`: its process's, by the tab's title when it has several. */
export function browserWindowFor(windows: readonly CompositorWindow[], browserPid: number, tab: Pick<TabInfo, "title">): CompositorWindow | null {
  const own = windows.filter((window) => window.pid === browserPid && window.state !== "minimized");
  if (own.length <= 1) return own[0] ?? null;
  const titled = own.filter((window) => tab.title !== "" && window.title.startsWith(tab.title));
  return titled.length === 1 ? (titled[0] ?? null) : (titled.find((window) => window.focused) ?? null);
}

/**
 * A rect in the page's CSS pixels to the window's content points: the page
 * fills the content's width and its bottom (the toolbar is above it), so the
 * ratio of widths is the zoom, and the page starts where its height ends.
 */
export function viewportToWindow(rect: Rect, viewport: { width: number; height: number }, content: { width: number; height: number }): Rect | null {
  if (viewport.width <= 0 || content.width <= 0) return null;
  const scale = content.width / viewport.width;
  const top = Math.max(0, content.height - viewport.height * scale);
  return { x: rect.x * scale, y: top + rect.y * scale, width: rect.width * scale, height: rect.height * scale };
}

export interface BrowserField {
  window: CompositorWindow;
  inspect(): Promise<FieldInfo>;
  /** Mark the field Dashi types into, before the secret goes in: blanked in pictures, "filled by Dashi" in read_page. */
  filled(field: Placed): void;
  /** What Dashi typed was typed: from now on the check is of the field with the focus (sign-in's Tab moves it). */
  typed(): void;
}

/** The field `ref` of a tab, focused and ready for Dashi's check; or why not. */
export async function browserField(
  ref: number,
  wanted: number | null,
  ctx: RunContext,
  cmdlineOf: (pid: number) => string[] | null,
): Promise<BrowserField | ToolResult> {
  const link: BrowserLink | null = ctx.browser.link();
  if (!link) return toolError(NO_EXTENSION);
  const tab = await chooseTab(link, wanted, ctx);
  if ("content" in tab) return tab;
  ctx.browser.tab = tab.id;
  const ask = async (focus: boolean, frameId: number | null): Promise<FieldReport> => {
    const params = frameId === null ? { tab: tab.id, ref, focus } : { tab: tab.id, frameId };
    const report = parseField(await link.ask("field", params));
    if (!report) throw new Error("The browser didn't describe that field.");
    return report;
  };
  let first: FieldReport;
  try {
    first = await ask(true, null);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
  const window = browserWindowFor(await ctx.compositor.windows(), link.hello.browserPid, first.tab);
  if (!window) return toolError("Dashi can't tell which of the browser's windows shows that tab; bring it to the front and try again.");
  const frameId = first.frameId;
  let typed = false;
  const content = () => ({ width: window.frame?.width ?? 0, height: (window.frame?.height ?? 0) - window.titleBar });
  const place = (report: FieldReport): Rect | null => (report.rect ? viewportToWindow(report.rect, report.viewport, content()) : null);
  const again = async (): Promise<Placed | "gone" | "hidden"> => {
    try {
      const report = await ask(false, null);
      return { rect: place(report), page: null };
    } catch {
      return "gone";
    }
  };
  // Placed again by its number; a field found by the focus (after Tab) stays blanked where it was.
  const focused = (report: FieldReport, byRef: boolean): Focused | null =>
    report.focused ? { kind: report.kind, documents: report.documents, rect: place(report), page: null, ...(byRef ? { again } : {}) } : null;
  return {
    window,
    inspect: async () => {
      // Until Dashi types, the agent's field is focused again each time (the sheet came and went); after, whatever has the focus.
      const report = typed ? await ask(false, frameId) : await ask(true, null);
      return { focused: focused(report, !typed), cmdline: cmdlineOf(link.hello.browserPid) };
    },
    filled: (field) => {
      ctx.secrets.filled(window.id, field.rect, field.again);
      void link.ask("filled", typed ? { tab: tab.id, frameId } : { tab: tab.id, ref }).catch(() => {});
    },
    typed: () => {
      typed = true;
    },
  };
}
