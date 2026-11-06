/**
 * Reading and writing the clipboard by type, through wl-clipboard: `wl-paste`
 * and `wl-copy` run as children of the shell, so the compositor serves them
 * ext-data-control (the shell's processes only), and the person's focus
 * never moves. A read is capped in bytes and in time: an app that serves a
 * huge copy, or never answers, costs nothing.
 */

/** How long a copying app has to hand its data over. */
const READ_MS = 2_000;

export interface ClipboardIo {
  /** The clipboard's data as `mime`, or null (none of it, too large, too slow, no wl-paste). */
  read(mime: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Put `data` on the clipboard as `mime`; whether wl-copy took it. */
  write(mime: string, data: Uint8Array | string): Promise<boolean>;
}

/** `bytes` read from `stream`, or null once there are more than `max`. */
export async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > max) return null;
    chunks.push(chunk);
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

export function wlClipboard(which: (program: string) => string | null = (program) => Bun.which(program)): ClipboardIo {
  const paste = which("wl-paste");
  const copy = which("wl-copy");
  return {
    async read(mime, maxBytes) {
      if (!paste) return null;
      try {
        const child = Bun.spawn([paste, "--no-newline", "--type", mime], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
        const timer = setTimeout(() => child.kill(), READ_MS);
        const bytes = await readCapped(child.stdout, maxBytes);
        if (bytes === null) child.kill();
        const code = await child.exited;
        clearTimeout(timer);
        return code === 0 ? bytes : null;
      } catch {
        return null;
      }
    },
    async write(mime, data) {
      if (!copy) return false;
      try {
        const child = Bun.spawn([copy, "--type", mime], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        child.stdin.write(data);
        await child.stdin.end();
        return (await child.exited) === 0;
      } catch {
        return false;
      }
    },
  };
}
