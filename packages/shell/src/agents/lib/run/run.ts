/**
 * Carrying out tool calls: windows and apps through the compositor's IPC,
 * everything else through the desktop's own stores (desktop/). Window ids
 * are the compositor's numbers as "w3". A screenshot waits until no consent
 * sheet is on screen; a launch waits for the app's first new window. Each
 * kind of tool has its handlers in its own file (run-*.ts); this joins them,
 * and the compiler checks that every tool has one.
 */

import type { RunContext, ToolResult } from "../../context.ts";
import * as desktop from "../../desktop/index.ts";
import { browserCall, handOver, listLogins, payCall, signInCall } from "../../desktop/index.ts";
import type { Call, ToolName } from "../../tools/index.ts";
import { appHandlers } from "./run-apps.ts";
import { desktopHandlers } from "./run-desktop.ts";
import { documentHandlers } from "./run-documents.ts";
import { screenHandlers } from "./run-screen.ts";
import { systemHandlers } from "./run-system.ts";
import type { Handlers } from "./run-types.ts";
import { windowTreeCall } from "./run-window-tree.ts";
import { windowHandlers } from "./run-windows.ts";

/** Signing in and paying, the websites, and the agent's own pointer and keyboard. */
const personalHandlers = {
  list_logins: listLogins,
  sign_in: signInCall,
  fill_code: signInCall,
  pay: payCall,
  hand_over: handOver,
  read_window: windowTreeCall,
  act_on_element: windowTreeCall,
  open_url: browserCall,
  read_page: browserCall,
  click_element: (call, ctx) => (call.window !== null ? windowTreeCall(call, ctx) : browserCall(call, ctx)),
  fill_element: (call, ctx) => (call.window !== null ? windowTreeCall(call, ctx) : browserCall(call, ctx)),
  select_option: (call, ctx) => (call.window !== null ? windowTreeCall(call, ctx) : browserCall(call, ctx)),
  press: browserCall,
  scroll_page: (call, ctx) => (call.window !== null ? windowTreeCall(call, ctx) : browserCall(call, ctx)),
  list_tabs: desktop.tabsCall,
  switch_tab: desktop.tabsCall,
  close_tab: desktop.tabsCall,
  reload_tab: desktop.tabsCall,
  go_back: desktop.tabsCall,
  go_forward: desktop.tabsCall,
  wait_for: desktop.waitFor,
  attach_file: desktop.attachFile,
  click_in_element: desktop.clickInElement,
  screenshot_element: desktop.screenshotElement,
  list_downloads: desktop.listDownloads,
  click: desktop.handsCall,
  scroll: desktop.handsCall,
  drag: desktop.handsCall,
  type_text: desktop.handsCall,
  press_keys: desktop.handsCall,
} satisfies Handlers<
  | "list_logins"
  | "sign_in"
  | "fill_code"
  | "pay"
  | "hand_over"
  | "read_window"
  | "act_on_element"
  | "open_url"
  | "read_page"
  | "click_element"
  | "fill_element"
  | "select_option"
  | "press"
  | "scroll_page"
  | "list_tabs"
  | "switch_tab"
  | "close_tab"
  | "reload_tab"
  | "go_back"
  | "go_forward"
  | "wait_for"
  | "attach_file"
  | "click_in_element"
  | "screenshot_element"
  | "list_downloads"
  | "click"
  | "scroll"
  | "drag"
  | "type_text"
  | "press_keys"
>;

const HANDLERS: Handlers<ToolName> = {
  ...appHandlers,
  ...windowHandlers,
  ...screenHandlers,
  ...desktopHandlers,
  ...documentHandlers,
  ...systemHandlers,
  ...personalHandlers,
};

export async function runCall(call: Call, ctx: RunContext): Promise<ToolResult> {
  // Each handler takes its own tool's call, and `call.name` picked it.
  const handler = HANDLERS[call.name] as (call: Call, ctx: RunContext) => Promise<ToolResult> | ToolResult;
  return handler(call, ctx);
}
