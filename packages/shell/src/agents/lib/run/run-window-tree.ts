/** Native windows' element trees (window-tree/): read_window, and the website tools given a `window`. */

import type { RunContext, ToolResult } from "../../context.ts";
import type { Call } from "../../tools/index.ts";
import { actOn, clickOn, fillIn, readWindow, scrollTo, selectIn } from "../../window-tree/index.ts";

type TreeCall = Extract<Call, { name: "read_window" | "act_on_element" | "click_element" | "fill_element" | "select_option" | "scroll_page" }>;

export async function windowTreeCall(call: TreeCall, ctx: RunContext): Promise<ToolResult> {
  switch (call.name) {
    case "read_window":
      return readWindow(call, ctx);
    case "act_on_element":
      return actOn(call, ctx);
    case "click_element":
      return clickOn(call, ctx);
    case "fill_element":
      return fillIn(call, ctx);
    case "select_option":
      return selectIn(call, ctx);
    case "scroll_page":
      return scrollTo({ ref: call.ref ?? 0, window: call.window }, ctx);
  }
}
