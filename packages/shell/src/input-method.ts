/**
 * Input methods (Settings › Keyboard › Input method; settings.json
 * `inputMethod.engine`): the session starts the one the person picked, so
 * Chinese, Japanese, Korean and other scripts can be typed into every
 * field, the launcher's and the sheets' (layer surfaces) included. Fcitx 5
 * is the one offered: it speaks the input-method protocol dashi-comp serves
 * (zwp_input_method_v2), and Dashi's own fields and GTK's reach it through
 * text-input-v3. IBus speaks only an older protocol dashi-comp doesn't.
 *
 * dashi-comp lets only the session's own processes be an input method
 * (handlers/text.rs), so the shell runs it as its child, never daemonized
 * (`-d` would leave the session's process tree), replacing one an autostart
 * entry started. One that exits on its own is started again, a few times.
 * X11 apps find it through XMODIFIERS, which the shell's children inherit
 * from then on.
 */

export const INPUT_METHODS = ["none", "fcitx5"] as const;
export type InputMethodName = (typeof INPUT_METHODS)[number];
export const DEFAULT_INPUT_METHOD: InputMethodName = "none";

/** What starts `name`, when it is installed (`has`); null for none. */
export function inputMethodCommand(name: InputMethodName, has: (program: string) => boolean): string[] | null {
  if (name === "fcitx5" && has("fcitx5")) return ["fcitx5", "--replace"];
  return null;
}

/** What apps started after it need to find it (X11's XIM); nothing for none. */
export function inputMethodEnv(name: InputMethodName): Record<string, string> {
  return name === "fcitx5" ? { XMODIFIERS: "@im=fcitx" } : {};
}

/** A started process, as the runner needs it. */
export interface Child {
  readonly exited: Promise<number | null>;
  kill(): void;
}

export interface InputMethodDeps {
  has: (program: string) => boolean;
  spawn: (command: readonly string[]) => Child;
  /** The environment the shell's children inherit. */
  env: Record<string, string | undefined>;
  /** Waits between restarts. */
  wait?: (ms: number) => Promise<void>;
}

/** An input method that quits on its own is started again this many times. */
const RESTARTS = 3;
const RESTART_MS = 2_000;

/** Runs the chosen input method; the same choice twice does nothing. */
export class InputMethodRunner {
  private name: InputMethodName = "none";
  private child: Child | null = null;
  private restarts = 0;

  constructor(private readonly deps: InputMethodDeps) {}

  get running(): boolean {
    return this.child !== null;
  }

  apply(name: InputMethodName): void {
    if (name === this.name) return;
    this.stop();
    this.name = name;
    this.restarts = 0;
    this.start();
  }

  /** Stop the one the shell started (the shell's own child, by its handle). */
  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    for (const key of Object.keys(inputMethodEnv(this.name))) delete this.deps.env[key];
  }

  private start(): void {
    const command = inputMethodCommand(this.name, this.deps.has);
    if (!command) {
      if (this.name !== "none") console.error(`dashi-shell: the input method ${this.name} is not installed`);
      return;
    }
    let child: Child;
    try {
      child = this.deps.spawn(command);
    } catch (error) {
      console.error(`dashi-shell: could not start ${command[0]}:`, error instanceof Error ? error.message : error);
      return;
    }
    this.child = child;
    Object.assign(this.deps.env, inputMethodEnv(this.name));
    void child.exited.then(async (code) => {
      // Stopped, or replaced by another choice: nothing to do.
      if (this.child !== child) return;
      this.child = null;
      if (this.restarts >= RESTARTS) {
        console.error(`dashi-shell: ${command[0]} keeps quitting (${code}); not starting it again`);
        return;
      }
      this.restarts += 1;
      await (this.deps.wait ?? Bun.sleep)(RESTART_MS);
      if (this.child === null && inputMethodCommand(this.name, this.deps.has)?.[0] === command[0]) this.start();
    });
  }
}
