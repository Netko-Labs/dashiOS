/**
 * applet.json: who an applet is, when it applies, and what it may touch. The
 * store lists it from this, the sandbox gives it exactly its `permissions`,
 * the shell checks the `hello` an applet sends against the installed copy,
 * and the catalog's CI refuses a package whose manifest doesn't validate.
 * The JSON Schema (`manifest.schema.json`) says the same for editors;
 * this parser is the authority.
 *
 *   {
 *     "id": "dev.netko.asus-control",
 *     "name": "ASUS Control",
 *     "version": "0.1.0",
 *     "dashi": ">=0.4",
 *     "entry": "src/main.tsx",
 *     "summary": "Fans, power and lights for ROG and TUF laptops.",
 *     "author": { "name": "Netko Labs" },
 *     "when": { "vendor": "ASUSTeK COMPUTER INC." },
 *     "permissions": ["hardware.power", "hardware.lighting", "dbus.system:xyz.ljones.Asusd", "notifications"]
 *   }
 */

import { type AppletCommand, parseCommands } from "./commands.ts";
import { isRefusal, list, optionalText, type Refusal, record, refuse, text } from "./parse.ts";
import { type Permission, parsePermission, permissionName } from "./permissions.ts";
import { parseWhen, type When } from "./when.ts";

export const CATEGORIES = ["hardware", "productivity", "network", "status", "media", "developer", "utilities"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Author {
  name: string;
  url?: string;
  email?: string;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  /** The Dashi versions it runs on (">=0.4"). */
  dashi: string;
  /** The source file the package's main.js is built from, relative to applet.json. */
  entry: string;
  summary: string;
  description?: string;
  author: Author;
  license?: string;
  /** Where its source is (https). */
  source?: string;
  categories: Category[];
  when?: When;
  permissions: Permission[];
  /** Pictures for the store, relative to applet.json. */
  screenshots: string[];
  /** Its icon, relative to applet.json (an .svg or a .png). */
  icon?: string;
  /** What it adds to the launcher (commands.ts); none is the default. */
  commands: AppletCommand[];
}

/** Reverse-DNS, lowercase: `dev.netko.asus-control`. Also a folder name and a systemd unit's. */
const APPLET_ID = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*){2,}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const RANGE = /^(>=|\^|~)?(\d+)(\.\d+)?(\.\d+)?$/;
const HTTPS = /^https:\/\/[^\s"<>]+$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A path inside the applet's folder: relative, no `..`, no hidden parts. */
export function isInsidePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

function insidePath(value: unknown, what: string, extensions: RegExp): string | Refusal {
  if (typeof value !== "string" || !isInsidePath(value) || value.length > 200) return refuse(`${what} must be a path inside the applet's folder`);
  return extensions.test(value) ? value : refuse(`${what} has the wrong kind of file`);
}

function parseAuthor(value: unknown): Author | Refusal {
  const fields = record(value, "author", ["name", "url", "email"]);
  if (isRefusal(fields)) return fields;
  const name = text(fields.name, "author.name", 60);
  if (isRefusal(name)) return name;
  if (fields.url !== undefined && (typeof fields.url !== "string" || !HTTPS.test(fields.url))) return refuse("author.url must be an https address");
  if (fields.email !== undefined && (typeof fields.email !== "string" || !EMAIL.test(fields.email))) return refuse("author.email is not an address");
  return { name, ...(fields.url === undefined ? {} : { url: fields.url as string }), ...(fields.email === undefined ? {} : { email: fields.email as string }) };
}

const FIELDS = [
  "$schema",
  "id",
  "name",
  "version",
  "dashi",
  "entry",
  "summary",
  "description",
  "author",
  "license",
  "source",
  "categories",
  "when",
  "permissions",
  "screenshots",
  "icon",
  "commands",
] as const;

export function parseManifest(value: unknown): Manifest | Refusal {
  const fields = record(value, "applet.json", FIELDS);
  if (isRefusal(fields)) return fields;
  if (typeof fields.id !== "string" || fields.id.length > 64 || !APPLET_ID.test(fields.id))
    return refuse("id must be reverse-DNS in lowercase, such as dev.example.weather (64 characters at most)");
  const name = text(fields.name, "name", 40);
  if (isRefusal(name)) return name;
  if (typeof fields.version !== "string" || !SEMVER.test(fields.version)) return refuse("version must be a semantic version, such as 0.1.0");
  if (typeof fields.dashi !== "string" || !RANGE.test(fields.dashi)) return refuse('dashi must be a version range, such as ">=0.4"');
  const entry = insidePath(fields.entry, "entry", /\.(tsx?|jsx?)$/);
  if (isRefusal(entry)) return entry;
  const summary = text(fields.summary, "summary", 80);
  if (isRefusal(summary)) return summary;
  const description = optionalText(fields.description, "description", 2000);
  if (isRefusal(description)) return description;
  const author = parseAuthor(fields.author);
  if (isRefusal(author)) return author;
  const license = optionalText(fields.license, "license", 40);
  if (isRefusal(license)) return license;
  if (fields.source !== undefined && (typeof fields.source !== "string" || !HTTPS.test(fields.source))) return refuse("source must be an https address");
  const categories =
    fields.categories === undefined
      ? []
      : list(
          fields.categories,
          "categories",
          3,
          (entry, where) => CATEGORIES.find((each) => each === entry) ?? refuse(`${where} must be one of ${CATEGORIES.join(", ")}`),
        );
  if (isRefusal(categories)) return categories;
  const when = fields.when === undefined ? undefined : parseWhen(fields.when);
  if (isRefusal(when)) return when;
  const permissions = list(fields.permissions ?? [], "permissions", 32, (entry, where) => {
    const permission = parsePermission(entry);
    return "error" in permission ? refuse(`${where}: ${permission.error}`) : permission;
  });
  if (isRefusal(permissions)) return permissions;
  const names = permissions.map(permissionName);
  const twice = names.find((each, at) => names.indexOf(each) !== at);
  if (twice) return refuse(`permissions lists “${twice}” twice`);
  const screenshots = list(fields.screenshots ?? [], "screenshots", 8, (entry, where) => insidePath(entry, where, /\.(png|jpe?g|webp)$/i));
  if (isRefusal(screenshots)) return screenshots;
  const icon = fields.icon === undefined ? undefined : insidePath(fields.icon, "icon", /\.(svg|png)$/i);
  if (isRefusal(icon)) return icon;
  const commands = fields.commands === undefined ? [] : parseCommands(fields.commands);
  if (isRefusal(commands)) return commands;
  return {
    id: fields.id,
    name,
    version: fields.version,
    dashi: fields.dashi,
    entry,
    summary,
    ...(description === undefined ? {} : { description }),
    author,
    ...(license === undefined ? {} : { license }),
    ...(fields.source === undefined ? {} : { source: fields.source as string }),
    categories,
    ...(when === undefined ? {} : { when }),
    permissions,
    screenshots,
    ...(icon === undefined ? {} : { icon }),
    commands,
  };
}

/** applet.json's text, parsed. */
export function readManifest(json: string): Manifest | Refusal {
  try {
    return parseManifest(JSON.parse(json));
  } catch {
    return refuse("applet.json is not JSON");
  }
}

/** The manifest as applet.json writes it (permissions by name; no `commands` when it has none). */
export function manifestJson(manifest: Manifest): Record<string, unknown> {
  const { commands, ...rest } = manifest;
  return { ...rest, permissions: manifest.permissions.map(permissionName), ...(commands.length > 0 ? { commands } : {}) };
}

/** -1, 0, 1 as semantic versions order (a pre-release before its release). */
export function compareVersions(a: string, b: string): number {
  const split = (version: string): [number[], string] => {
    const [core = "", pre = ""] = version.split(/-(.*)/s);
    return [core.split(".").map((part) => Number(part) || 0), pre];
  };
  const [left, leftPre] = split(a);
  const [right, rightPre] = split(b);
  for (let at = 0; at < 3; at++) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (leftPre === rightPre) return 0;
  if (leftPre === "") return 1;
  if (rightPre === "") return -1;
  return leftPre < rightPre ? -1 : 1;
}

/** Whether Dashi `version` (0.4.0) is in `range` (">=0.4", "^0.4", "~0.4.1", "0.4"). */
export function dashiSatisfies(range: string, version: string): boolean {
  const match = RANGE.exec(range);
  if (!match) return false;
  const [, op = "", major = "0", minor = ".0", patch = ".0"] = match;
  const floor = `${major}${minor}${patch}`;
  const atLeast = compareVersions(version.replace(/-.*/, ""), floor) >= 0;
  const [vMajor, vMinor] = version.split(".");
  if (op === ">=") return atLeast;
  if (op === "^") return atLeast && (major === "0" ? vMajor === "0" && vMinor === minor.slice(1) : vMajor === major);
  if (op === "~") return atLeast && vMajor === major && vMinor === minor.slice(1);
  return vMajor === major && (match[3] === undefined || vMinor === minor.slice(1));
}
