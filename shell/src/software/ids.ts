/**
 * Flatpak application ids, checked before they go anywhere: into a command's
 * arguments, a URL path, or a file name. An id is reverse-DNS: at least two
 * dot-separated elements of letters, digits, `_`, and `-`, and it never
 * starts with `-` (so it cannot be read as an option).
 */

const ELEMENT = "[A-Za-z0-9_][A-Za-z0-9_-]*";
const APP_ID = new RegExp(`^${ELEMENT}(?:\\.${ELEMENT})+$`);

export function isAppId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && APP_ID.test(value);
}

/** `value` if it is an application id. */
export function appIdOrNull(value: unknown): string | null {
  return isAppId(value) ? value : null;
}

/** The two installations Software works on; a named system installation is never used. */
export type Installation = "user" | "system";

export function isInstallation(value: unknown): value is Installation {
  return value === "user" || value === "system";
}
