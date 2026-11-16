/**
 * Files in and out of web pages: attach_file puts a file into a page's file
 * field (the chooser is never shown); list_downloads lists what the browser
 * downloaded. A click that starts a download says where it landed
 * (click_element). Neither asks: attaching sends nothing until the form is.
 */

import { optional } from "@dashi/shape";
import type { ToolDef } from "../define.ts";
import { custom, tool, wholeArg } from "./args.ts";
import { refArg, tabArg } from "./browser.ts";

export const transferTools: readonly ToolDef[] = [
  tool({
    name: "attach_file",
    title: "Attach a file on a web page",
    description:
      "Put a file into a page's file field (a `file chooser` read_page numbered), as if the person had chosen it, with no chooser window. " +
      "The path follows read_text_file's rules (home folder and removable drives, never secrets); 25 MB at most. Nothing is sent until the form is submitted.",
    scope: "web",
    readOnly: false,
    destructive: false,
    args: {
      ref: refArg("The file chooser's number from read_page."),
      path: custom(
        { type: "string", maxLength: 4096, description: "The file's absolute path (or ~/…)." },
        (value) => (typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : null),
        "`path` is required: the file's absolute path.",
      ),
      tab: tabArg(),
    },
    build: ({ ref, path, tab }) => ({ name: "attach_file", ref, path, tab: tab ?? null }),
  }),
  tool({
    name: "list_downloads",
    title: "List downloads",
    description: "The browser's downloads, newest first: where each file is, its address, its type, whether it is complete, and its size.",
    scope: "web",
    readOnly: true,
    destructive: false,
    idempotent: true,
    args: { limit: optional(wholeArg(1, 100, "`limit` is a whole number from 1 to 100.", "How many, default 20.")) },
    build: ({ limit }) => ({ name: "list_downloads", limit: limit ?? 20 }),
  }),
];
