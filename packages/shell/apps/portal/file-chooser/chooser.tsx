/**
 * org.freedesktop.impl.portal.FileChooser: OpenFile, SaveFile, SaveFiles.
 * The calls are read (options.ts), the sheet asks (Files' chooser,
 * apps/files/chooser/: Files' sidebar, icons and keys), and the answer goes
 * back as file URIs; xdg-desktop-portal hands a sandboxed app the files
 * through the document portal.
 */

import { existsSync } from "node:fs";
import type { InterfaceSpec } from "../../../src/shared/dbus/index.ts";
import { ChooserView, type Env, openChooser } from "../../files/index.ts";
import type { Requests } from "../request.ts";
import type { ShowDialog } from "../windows.ts";
import { type ChooserAnswer, type ChooserMode, type ChooserRequest, chooserReply, parseChooser } from "./options.ts";

export const FILE_CHOOSER = "org.freedesktop.impl.portal.FileChooser";

/** Asks the person; null when they cancelled (or the app gave up). */
export type ChooseFiles = (request: ChooserRequest, signal: AbortSignal) => Promise<ChooserAnswer | null>;

export function fileChooserInterface(requests: Requests, choose: ChooseFiles): InterfaceSpec {
  const method = (mode: ChooserMode) => ({
    in: "osssa{sv}",
    out: "ua{sv}",
    handler: ([handle, ...rest]: unknown[]) => requests.run(handle, async (signal) => chooserReply(await choose(parseChooser(mode, rest), signal))),
  });
  return {
    name: FILE_CHOOSER,
    methods: { OpenFile: method("open"), SaveFile: method("save"), SaveFiles: method("save-files") },
    properties: { version: { type: "u", get: () => 4 } },
  };
}

/** The real sheet, on screen. */
/**
 * The chooser window's least size: its sidebar and one toolbar row (back,
 * up, the title cut short, the folder, the views, a new folder and the
 * search at its least) side by side, so nothing is pushed past the edge.
 */
export const CHOOSER_LEAST = { width: 720, height: 400 } as const;

export function chooseOnScreen(show: ShowDialog, env?: Env): ChooseFiles {
  return async (request, signal) => {
    const model = openChooser(request, env);
    try {
      return await show<ChooserAnswer | null>(
        { parent: request.parent, title: request.title, width: 820, height: 520, least: CHOOSER_LEAST },
        (answer) => <ChooserView model={model} title={request.title} exists={existsSync} answer={answer} />,
        signal,
        null,
      );
    } finally {
      model.stop();
    }
  };
}
