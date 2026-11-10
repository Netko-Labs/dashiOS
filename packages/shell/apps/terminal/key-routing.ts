/**
 * Where a key in the grid goes. ❖ chords are the menu bar's (copy, paste,
 * tabs, prompts, windows), never the program's. A lost tab (its engine went
 * away) takes only Return, which starts a new shell. ⇧PgUp and ⇧PgDn page
 * through the scrollback and the program never sees them; every other key is
 * sent to the engine, which encodes it the way the program asked.
 */

import type { KeyDownInfo } from "@mirinjs/metal";
import type { EngineInput } from "./engine.ts";
import type { Tab } from "./tabs.ts";

export interface KeyRoute {
  /** The tab in front, if any. */
  front: Tab | undefined;
  /** Sends to the front tab's engine. */
  send(input: EngineInput): void;
  /** Starts the front tab's shell again (its engine went away). */
  restart(): void;
  /** Rows a page of scrollback moves: the grid's rows less one. */
  pageRows: number;
}

export function routeKey(key: KeyDownInfo, route: KeyRoute): void {
  if (key.meta) return;
  if (route.front?.lost) {
    if (key.key === "enter") route.restart();
    return;
  }
  if (key.shift && !key.ctrl && !key.alt && (key.key === "pageup" || key.key === "pagedown")) {
    route.send({ t: "scroll", lines: key.key === "pageup" ? route.pageRows : -route.pageRows });
    return;
  }
  route.send({ t: "key", ...key });
}
