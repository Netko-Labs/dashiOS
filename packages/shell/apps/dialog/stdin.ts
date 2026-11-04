/**
 * Stdin as it comes, for the dialogs a script feeds (progress, a list's
 * rows, text-info): each complete line is handed on as it arrives, the last
 * one without a newline too, then the end. Reading stops when `stop` is
 * called (the dialog went first).
 */

/** Splits text that arrives in pieces into lines; `rest` is the partial line held back. */
export class LineSplitter {
  private rest = "";

  /** The complete lines in `chunk` (and what came before it). */
  push(chunk: string): string[] {
    const lines = (this.rest + chunk).split("\n");
    this.rest = lines.pop() ?? "";
    return lines;
  }

  /** The partial last line, if any, at the end of the input. */
  end(): string[] {
    const last = this.rest;
    this.rest = "";
    return last === "" ? [] : [last];
  }
}

export function readStdinLines(onLine: (line: string) => void, onEnd: () => void): () => void {
  let stopped = false;
  const reader = Bun.stdin.stream().getReader();
  void (async () => {
    const decoder = new TextDecoder();
    const lines = new LineSplitter();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (stopped) return;
        if (done) break;
        for (const line of lines.push(decoder.decode(value, { stream: true }))) onLine(line);
      }
      for (const line of lines.push(decoder.decode())) onLine(line);
      for (const line of lines.end()) onLine(line);
    } catch {
      // Stdin went away: the same as its end.
    }
    if (!stopped) onEnd();
  })();
  return () => {
    stopped = true;
    void reader.cancel().catch(() => {});
  };
}

/** Stdin's text as it grows, for text-info: each piece as it arrives, then the end. */
export function readStdinText(onText: (text: string) => void, onEnd: () => void): () => void {
  let stopped = false;
  const reader = Bun.stdin.stream().getReader();
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (stopped) return;
        if (done) break;
        onText(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Stdin went away: the same as its end.
    }
    if (!stopped) onEnd();
  })();
  return () => {
    stopped = true;
    void reader.cancel().catch(() => {});
  };
}
