/**
 * AppStream catalog files read into the Store's own small record: Flathub's
 * `appstream.xml.gz`, Fedora's `appstream-data` and RPM Fusion's in
 * `/usr/share/swcatalog/xml`. One pass over the text, one component at a
 * time; only the untranslated name, summary, developer, keywords and
 * categories, the package or Flatpak id, an icon, the licence and Flathub's
 * verified flag are kept. Everything is cut to length; nothing from the file
 * reaches a path or a command line (ids are checked by their callers).
 */

export interface AppStreamApp {
  /** The component id without `.desktop` (`org.gimp.GIMP`). */
  id: string;
  /** `desktop-application`, `console-application`, `desktop` (old files: an app). */
  type: string;
  name: string;
  summary: string;
  developer: string | null;
  /** Fedora's and RPM Fusion's: the package that holds it. */
  pkgname: string | null;
  /** Flathub's: the Flatpak ref's id (`app/org.gimp.GIMP/x86_64/stable` → `org.gimp.GIMP`). */
  flatpak: string | null;
  /** The desktop file it launches, without `.desktop`. */
  desktopId: string | null;
  /** An https address (Flathub) or a cached file name (Fedora; see `iconFile`). */
  icon: { kind: "remote" | "cached"; value: string } | null;
  categories: string[];
  keywords: string[];
  license: string | null;
  verified: boolean;
}

const COMPONENT = /<component\b([^>]*)>([\s\S]*?)<\/component>/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text to plain text: entities decoded, whitespace folded, cut to `max`. */
export function plain(text: string, max = 200): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The first `<tag>` with no `xml:lang` (or `xml:lang="en"`), as plain text. */
function first(body: string, tag: string, max = 200): string | null {
  const pattern = new RegExp(`<${tag}((?:\\s[^>]*)?)>([\\s\\S]*?)</${tag}>`, "g");
  for (const match of body.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    if (/xml:lang="(?!en")/.test(attrs)) continue;
    const text = plain(match[2] ?? "", max);
    if (text !== "") return text;
  }
  return null;
}

function all(body: string, tag: string, max: number): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}((?:\\s[^>]*)?)>([^<]*)</${tag}>`, "g");
  for (const match of body.matchAll(pattern)) {
    if (/xml:lang="(?!en")/.test(match[1] ?? "")) continue;
    const text = plain(match[2] ?? "", 60);
    if (text !== "" && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

const stripDesktop = (id: string): string => id.replace(/\.desktop$/, "");

function iconOf(body: string): AppStreamApp["icon"] {
  let best: { kind: "remote" | "cached"; value: string; size: number } | null = null;
  for (const match of body.matchAll(/<icon\b([^>]*)>([^<]+)<\/icon>/g)) {
    const attrs = match[1] ?? "";
    const kind = /type="remote"/.test(attrs) ? "remote" : /type="cached"/.test(attrs) ? "cached" : null;
    if (kind === null) continue;
    const size = Number(/width="(\d+)"/.exec(attrs)?.[1] ?? 0);
    const value = (match[2] ?? "").trim();
    if (kind === "remote" && !value.startsWith("https://")) continue;
    // 128 is enough for a page; prefer it, then the next size down.
    const score = size === 128 ? 1000 : size > 128 ? 500 - size / 10 : size;
    if (best === null || score > best.size) best = { kind, value: value.slice(0, 300), size: score };
  }
  return best === null ? null : { kind: best.kind, value: best.value };
}

const APP_TYPES = new Set(["desktop-application", "desktop", "console-application"]);

/** Reads one component's body, or null when it is not an app (a runtime, a font, an add-on). */
export function readComponent(attrs: string, body: string): AppStreamApp | null {
  const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? "";
  if (!APP_TYPES.has(type)) return null;
  const rawId = first(body, "id", 160);
  const name = first(body, "name", 80);
  if (rawId === null || name === null) return null;
  const bundle = /<bundle type="flatpak"[^>]*>app\/([^/<]+)\//.exec(body)?.[1] ?? null;
  const launch = /<launchable type="desktop-id">([^<]+)<\/launchable>/.exec(body)?.[1] ?? null;
  const developer = first(
    body.replace(/<developer\b[^>]*>\s*<name/g, "<developer_name").replace(/<\/name>\s*<\/developer>/g, "</developer_name>"),
    "developer_name",
    80,
  );
  return {
    id: stripDesktop(rawId),
    type,
    name,
    summary: first(body, "summary", 160) ?? "",
    developer,
    pkgname: first(body, "pkgname", 100),
    flatpak: bundle,
    desktopId: launch === null ? (type === "desktop" ? stripDesktop(rawId) : null) : stripDesktop(plain(launch, 160)),
    icon: iconOf(body),
    categories: all(body, "category", 8),
    keywords: all(body, "keyword", 12),
    license: first(body, "project_license", 80),
    verified: /<value key="flathub::verification::verified">true<\/value>/.test(body),
  };
}

/** Every app in an AppStream catalog's text; anything else (runtimes, fonts, add-ons, a broken entry) is left out. */
export function parseAppStream(xml: string): AppStreamApp[] {
  const apps: AppStreamApp[] = [];
  for (const match of xml.matchAll(COMPONENT)) {
    const app = readComponent(match[1] ?? "", match[2] ?? "");
    if (app !== null) apps.push(app);
  }
  return apps;
}

/** A Fedora catalog's cached icon file: `/usr/share/swcatalog/icons/<origin>/128x128/<name>`, or 64x64 when there is no 128. */
export function iconFile(root: string, origin: string, name: string, exists: (path: string) => boolean): string | null {
  if (!/^[A-Za-z0-9._+-]+$/.test(name) || !/^[A-Za-z0-9._-]+$/.test(origin)) return null;
  for (const size of ["128x128", "64x64"]) {
    const path = `${root}/icons/${origin}/${size}/${name}`;
    if (exists(path)) return path;
  }
  return null;
}

/** The `origin` attribute of a catalog file (`fedora`, `rpmfusion-free-44`). */
export const originOf = (xml: string): string | null => /<components\b[^>]*\borigin="([^"]+)"/.exec(xml.slice(0, 2000))?.[1] ?? null;
