/**
 * Text an agent puts on the clipboard for the person (copy_to_clipboard):
 * kept in the history first, named for who put it there ("Dashi"), then
 * written; when the compositor reports the copy, the watch keeps that entry
 * as it is (`bump`), so it shows as Dashi's, not as the window's in front.
 */

import type { ClipboardHistory } from "../history.ts";
import type { ClipboardIo } from "./io.ts";
import type { PasteDeps } from "./paste.ts";

const TEXT = "text/plain;charset=utf-8";

export async function putText(
  text: string,
  from: string,
  deps: { history: ClipboardHistory; io: ClipboardIo; watch: PasteDeps["watch"]; enabled: () => boolean },
): Promise<boolean> {
  if (deps.enabled()) deps.history.add({ kind: "text", mime: TEXT, text, app: from });
  deps.watch.expect("text", text, "bump");
  const there = deps.watch.nextCopy(500);
  if (!(await deps.io.write(TEXT, text))) return false;
  await there;
  return true;
}
