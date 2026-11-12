/**
 * What the Activity Monitor asks of the app around it: copying a line, hearing
 * what a second start asks for (the kit's `onOpen`), and the quit actions
 * (quit.ts). main.tsx supplies them; view.tsx re-exports the type for the
 * tests.
 */

import type { OpenRequest } from "./args.ts";
import type { QuitActions } from "./quit.ts";

export interface MonitorActions extends QuitActions {
  copy(text: string): void;
  /** Hears what a second start asks for while the window is open (the kit's `onOpen`). */
  onOpen(listener: (request: OpenRequest) => void): void;
}
