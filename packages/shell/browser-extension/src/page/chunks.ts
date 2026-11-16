/**
 * A file to attach comes in chunks (native messaging carries a message of
 * 1 MB at most); the background puts them together here. Pure but for the
 * clock, so it is tested without a browser.
 */

/** Files on their way to a page's file field, by the shell's id for each: their chunks so far. */
const arriving = new Map<string, { chunks: string[]; at: number }>();

/** A chunk of a file to attach; the whole base64 once its last chunk is in, else null. */
export function takeChunk(id: string, index: number, total: number, chunk: string): string | null {
  // Anything left over from a call given up on, a minute old, goes.
  for (const [key, entry] of arriving) if (Date.now() - entry.at > 60_000) arriving.delete(key);
  const entry = arriving.get(id) ?? { chunks: [], at: Date.now() };
  entry.chunks[index] = chunk;
  arriving.set(id, entry);
  if (entry.chunks.filter((each) => each !== undefined).length < total) return null;
  arriving.delete(id);
  return entry.chunks.join("");
}
