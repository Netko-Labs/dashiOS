/**
 * org.freedesktop.impl.portal.FileChooser: OpenFile, SaveFile, SaveFiles.
 * The calls are read (options.ts), the sheet asks (view.tsx), and the
 * answer goes back as file URIs; xdg-desktop-portal hands a sandboxed app
 * the files through the document portal.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { InterfaceSpec } from "../../../src/dbus/index.ts";
import type { Requests } from "../request.ts";
import type { ShowDialog } from "../windows.ts";
import { startFolder, startName } from "./accept.ts";
import { ChooserModel } from "./model.ts";
import { type ChooserAnswer, type ChooserMode, type ChooserRequest, chooserReply, parseChooser } from "./options.ts";
import { documentsFolder, machineSources, placeLinks } from "./sources.ts";
import { ChooserView } from "./view.tsx";

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
export function chooseOnScreen(show: ShowDialog, home: string = homedir()): ChooseFiles {
  return (request, signal) => {
    const saveFolder = startFolder(request, documentsFolder(home), home);
    const model = new ChooserModel(request, machineSources(home), { folder: saveFolder, name: startName(request) });
    return show<ChooserAnswer | null>(
      { parent: request.parent, title: request.title, width: 760, height: 500 },
      (answer) => <ChooserView model={model} places={placeLinks(home)} saveFolder={saveFolder} exists={existsSync} answer={answer} />,
      signal,
      null,
    );
  };
}
