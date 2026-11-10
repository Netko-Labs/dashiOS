/** Files' public types: the parts of the machine a window or the chooser uses (env.ts `Env`). */

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
