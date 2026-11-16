/** Native windows' element trees (window-tree/): read_window, and the website tools given a `window`. */

import type { RunContext, ToolResult } from "../../context.ts";
import { toolError } from "../../context.ts";
import { waitAnswer } from "../../desktop/index.ts";
import type { Call } from "../../tools/index.ts";
import { actOn, clickOn, fillIn, readWindow, scrollTo, selectIn, type WindowUntil, waitOnWindow } from "../../window-tree/index.ts";

type TreeCall = Extract<Call, { name: "read_window" | "act_on_element" | "click_element" | "fill_element" | "select_option" | "scroll_page" | "wait_for" }>;

/** wait_for with a `window`: its tree (window-tree/wait.ts), answered in wait_for's words as for a page. */
async function waitInWindow(call: Extract<Call, { name: "wait_for" }>, window: number, ctx: RunContext): Promise<ToolResult> {
  const u = call.until;
  const asked: WindowUntil | null =
    "text" in u
      ? { text: u.text }
      : "textGone" in u
        ? { text: u.textGone, gone: true }
        : "ref" in u
          ? { ref: u.ref, state: u.state }
          : "page" in u
            ? { idle: true }
            : null;
  if (!asked) return toolError('With `window`, wait for `text`, `text_gone`, an `element` or `page: "quiet"`.');
  ctx.status(`Waiting on w${window}`);
  const waited = await waitOnWindow(window, asked, call.seconds * 1000, ctx);
  const answer = waitAnswer(call.until, waited.met, waited.ms, { window: `w${window}`, ...(waited.detail ? { detail: waited.detail } : {}) });
  // The page's words, said of the window.
  return {
    ...answer,
    content: answer.content.map((part) =>
      "text" in part ? { ...part, text: part.text.replace("the page to stop changing", `w${window} to stop changing`) } : part,
    ),
  };
}

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
    case "wait_for":
      return call.window === null ? toolError("wait_for needs a window here.") : waitInWindow(call, call.window, ctx);
    case "scroll_page":
      return scrollTo({ ref: call.ref ?? 0, window: call.window }, ctx);
  }
}
