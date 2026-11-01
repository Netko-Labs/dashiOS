/**
 * Lines out of a socket that delivers bytes in chunks. A chunk can end in
 * the middle of a multibyte character; one streaming decoder per connection
 * holds the cut-off bytes until the rest arrives, where decoding each chunk
 * on its own would turn them into U+FFFD.
 */

export class LineBuffer {
  private readonly decoder = new TextDecoder();
  private rest = "";

  /** The lines `chunk` completes (without their newlines). */
  push(chunk: Uint8Array): string[] {
    const parts = this.decoder.decode(chunk, { stream: true }).split("\n");
    const head = parts.shift() ?? "";
    if (parts.length === 0) {
      this.rest += head;
      return [];
    }
    const lines = [this.rest + head, ...parts.slice(0, -1)];
    this.rest = parts.at(-1) ?? "";
    return lines;
  }

  /** How much of an unfinished line is held (a runaway sender never ends one). */
  get pending(): number {
    return this.rest.length;
  }
}
