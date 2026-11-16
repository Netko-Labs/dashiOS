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
  /** The clipboard as HTML, when what was copied has it (a browser's selection); null otherwise. */
  readHtml?(): Promise<string | null>;
  /** Put a file's contents on the clipboard as `mime` (a picture as image/png); false when it can't. */
  writeFile?(path: string, mime: string): Promise<boolean>;
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
    async writeFile(path, mime) {
      if (!copy || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) return false;
      try {
        const child = Bun.spawn([copy, "--type", mime], { stdin: Bun.file(path), stdout: "ignore", stderr: "ignore" });
        return (await child.exited) === 0;
      } catch {
        return false;
      }
    },
    async readText() {
      return paste ? await run([paste, "--no-newline"]) : null;
    },
    async readHtml() {
      if (!paste) return null;
      const types = await run([paste, "--list-types"]);
      if (!types?.split("\n").some((type) => type.trim() === "text/html")) return null;
      return await run([paste, "--no-newline", "--type", "text/html"]);
    },
  };
}

/** A program's output, or null when it fails. */
async function run(command: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? text : null;
  } catch {
    return null;
  }
}
