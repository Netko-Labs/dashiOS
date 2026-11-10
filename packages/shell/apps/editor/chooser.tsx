/**
 * Open and Save As are Files' own chooser over the window
 * (apps/files/chooser/), never a typed path (PA-12): the request for the
 * sheet that is up, and the chooser drawn from it. This is the one file of
 * the editor that reaches into Files' chooser.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { useMemo } from "react";
import { AppChooser, chooserRequest } from "../files/chooser/index.ts";
import { resolveInput, suggestedSavePath } from "./names.ts";
import type { SheetState } from "./sheets.tsx";

export type EditorChooserRequest = ReturnType<typeof chooserRequest>;

/** The home folder as the session gives it ($HOME), as Files' chooser takes it. */
export const homeFolder = (): string => process.env.HOME || homedir();

/** The chooser's request while an Open or Save As sheet is up (one request per sheet shown), else null. */
export function useChooserRequest(sheet: SheetState | null, path: string | null, name: string, base: string): EditorChooserRequest | null {
  // biome-ignore lint/correctness/useExhaustiveDependencies: one request per sheet shown
  return useMemo(() => {
    if (sheet?.kind === "open") return chooserRequest("open", { appId: "dev.dashi.editor", title: "Open", currentFolder: base });
    if (sheet?.kind !== "save-as") return null;
    const home = homeFolder();
    const suggested = resolveInput(suggestedSavePath(path, home, existsSync(join(home, "Documents")), existsSync), base, home);
    return chooserRequest("save", {
      appId: "dev.dashi.editor",
      title: path === null ? `Save “${name}”` : "Save As",
      currentFolder: suggested ? dirname(suggested) : base,
      currentName: suggested ? basename(suggested) : `${name}.txt`,
    });
  }, [sheet]);
}

/** The chooser for `request`, over the editor's window; `answer` gets the paths chosen, or null for Cancel. */
export function EditorChooser({ request, answer }: { request: EditorChooserRequest; answer: (paths: string[] | null) => void }) {
  return <AppChooser request={request} answer={answer} />;
}
