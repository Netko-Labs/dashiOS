/**
 * `file://` URIs as GLib writes them, which is how the freedesktop thumbnail
 * cache keys files and how file managers hand files over on the clipboard.
 */

// g_filename_to_uri leaves these alone (unreserved plus the path-safe reserved set); everything else is %XX of its UTF-8 bytes.
const SAFE = /[A-Za-z0-9\-._~!$&'()*+,;=:@/]/;

export function fileUri(path: string): string {
  let out = "file://";
  for (const char of path) {
    if (SAFE.test(char)) {
      out += char;
    } else {
      for (const byte of new TextEncoder().encode(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/** The local path a `file://` URI names, or null for other schemes, other hosts, or a bad escape. */
export function parseFileUri(uri: string): string | null {
  const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(uri.trim());
  if (!match) return null;
  const host = match[1] ?? "";
  if (host !== "" && host.toLowerCase() !== "localhost") return null;
  try {
    const path = decodeURIComponent(match[2] ?? "");
    return path.includes("\0") ? null : path;
  } catch {
    return null;
  }
}
