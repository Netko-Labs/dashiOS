/**
 * The file browser's public types: the parts of the machine a window or the chooser uses (env.ts
 * `Env`), and what a chooser frame is given.
 */

import type { ChooserAnswer } from "../files/index.ts";
import type { ChooserModel } from "./chooser-model.ts";

export interface Archiver {
  tool: "zip" | "bsdtar";
  path: string;
}

export interface ClipboardFiles {
  paths: string[];
  /** Whether the source asked for a move (cut). */
  cut: boolean;
}

export interface SystemFiles {
  /** wl-copy is installed. */
  canWrite: boolean;
  write(paths: readonly string[]): Promise<boolean>;
  read(): Promise<ClipboardFiles | null>;
}

/**
 * What a chooser frame is given: the model, how to tell a file exists (a
 * save would replace it), and where the answer goes.
 */
export interface ChooserViewProps {
  model: ChooserModel;
  exists: (path: string) => boolean;
  answer: (value: ChooserAnswer | null) => void;
}
