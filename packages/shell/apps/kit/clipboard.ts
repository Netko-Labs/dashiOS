/**
 * The clipboard, for what Metal can't do from inside a window yet: Ctrl+V
 * already pastes into a focused text input (and hands a KeySink the clipboard's text), but
 * nothing reports Ctrl+C, and nothing writes the clipboard. Until Metal has
 * a clipboard API this goes through wl-clipboard (`wl-copy`, `wl-paste`)
 * when it is installed; without it copying does nothing and says so.
 */

export interface Clipboard {
  /** Whether `writeText` can work here. */
  canWrite: boolean;
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string | null>;
}

export function systemClipboard(which: (program: string) => string | null = (program) => Bun.which(program)): Clipboard {
  const copy = which("wl-copy");
  const paste = which("wl-paste");
  return {
    canWrite: copy !== null,
    async writeText(text) {
      if (!copy) return false;
      try {
        const child = Bun.spawn([copy], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        child.stdin.write(text);
        await child.stdin.end();
        return (await child.exited) === 0;
      } catch {
        return false;
      }
    },
    async readText() {
      if (!paste) return null;
      try {
        const child = Bun.spawn([paste, "--no-newline"], { stdout: "pipe", stderr: "ignore" });
        const text = await new Response(child.stdout).text();
        return (await child.exited) === 0 ? text : null;
      } catch {
        return null;
      }
    },
  };
}
