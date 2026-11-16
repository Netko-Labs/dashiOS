/**
 * wait_for in a page: the content script watches the document itself (a
 * MutationObserver) until text appears or goes, an element is there, enabled
 * or gone, or nothing has changed for a while. The model never polls: one
 * request waits here, and the answer says what happened and when.
 */

import { lineWith, type PageWait, type WaitResult } from "../page/wait.ts";
import { elementOf } from "./dom.ts";

/** How often, at most, the page's text is read again while it changes (innerText lays the page out). */
const CHECK_MS = 60;

const enabled = (element: Element): boolean =>
  !(element as HTMLInputElement).disabled && element.getAttribute("aria-disabled") !== "true" && element.closest("fieldset:disabled") === null;

/** Whether the wait is over now, and what to say of it. */
function check(wait: PageWait): { met: boolean; detail?: string } {
  switch (wait.kind) {
    case "text": {
      const line = lineWith(document.body?.innerText ?? "", wait.text);
      return line === null ? { met: false } : { met: true, detail: line };
    }
    case "text-gone":
      return { met: lineWith(document.body?.innerText ?? "", wait.text) === null };
    case "element": {
      const element = elementOf(wait.ref);
      if (wait.state === "gone") return { met: element === null };
      if (!element) return { met: false, detail: "not on the page" };
      if (wait.state === "present") return { met: true };
      return enabled(element) ? { met: true } : { met: false, detail: "there, but disabled" };
    }
    case "quiet":
      return { met: false };
  }
}

/** Until `wait` holds or `timeoutMs` passes; `now` and the observer are the page's own. */
export function waitInPage(wait: PageWait, timeoutMs: number): Promise<WaitResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  return new Promise((resolve) => {
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let last: { met: boolean; detail?: string } = { met: false };
    const observer = new MutationObserver(() => {
      if (wait.kind === "quiet") return restartQuiet();
      checkTimer ??= setTimeout(() => {
        checkTimer = null;
        test();
      }, CHECK_MS);
    });
    const deadline = setTimeout(() => finish({ met: false, ms: elapsed(), ...(last.detail ? { detail: last.detail } : {}) }), timeoutMs);
    function finish(result: WaitResult) {
      observer.disconnect();
      clearTimeout(deadline);
      if (checkTimer) clearTimeout(checkTimer);
      if (quietTimer) clearTimeout(quietTimer);
      resolve(result);
    }
    function test() {
      last = check(wait);
      if (last.met) finish({ met: true, ms: elapsed(), ...(last.detail ? { detail: last.detail } : {}) });
    }
    function restartQuiet() {
      if (wait.kind !== "quiet") return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish({ met: true, ms: elapsed() }), wait.quietMs);
    }
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    if (wait.kind === "quiet") restartQuiet();
    else test();
  });
}
