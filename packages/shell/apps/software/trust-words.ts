/**
 * The trust card's four facts, in words, for an app or an applet: who made
 * it (and who vouches for that: Flathub's verification, Dashi's review, the
 * author's signature), what it can reach (the plain lines applets, Flatpak
 * apps and Settings share), what changed in its newest version, and how many
 * people use it. Pure, so the card, the Get… sheet and the tests agree.
 */

import { cannotDo } from "@dashi/applet";
import { abilityLines, commandsLine } from "../../src/shared/applet-store/consent-sheet.tsx";
import type { StoreApplet } from "../../src/shared/applet-store/merge.ts";
import type { AppDetails } from "../../src/shared/software/flathub-types.ts";
import { cannotReach, describeReach } from "../../src/shared/software/flatpak-permissions.ts";

export interface TrustFacts {
  maker: { name: string; line: string; mark: "verified" | "reviewed" | null };
  /** For applets: the author's signature, which Dashi checks before installing. */
  signed: string | null;
  reach: { lines: string[]; cannot: string | null; known: boolean };
  changed: { heading: string; notes: string[] } | null;
  users: string | null;
}

/** A licence that isn't open source (Flathub writes `LicenseRef-proprietary…`). */
export const isProprietary = (license: string | null): boolean => license !== null && /proprietary/i.test(license);

/**
 * The License row's words: an SPDX expression as it is, and Flathub's
 * `LicenseRef-proprietary=https://…` as "Proprietary", linking to its terms.
 */
export function licenseWords(license: string): { value: string; link?: string } {
  const ref = /^LicenseRef-([^=\s]*)(?:=(\S+))?$/i.exec(license.trim());
  if (!ref) return { value: license };
  const name = ref[1] ?? "";
  const value = /^proprietary$/i.test(name) || name === "" ? "Proprietary" : name.replace(/[-_.]+/g, " ");
  let link: string | undefined;
  try {
    const url = new URL(ref[2] ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") link = url.href;
  } catch {
    link = undefined;
  }
  return link ? { value, link } : { value };
}

/** "120K installs last month". */
export function installsWords(count: number, locale = "en-US"): string {
  const number = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(count);
  return `${number} ${count === 1 ? "install" : "installs"} last month`;
}

const dayOf = (date: Date, locale: string): string => date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** "Version 3.0.22 · Nov 3, 2026", from what is known of it. */
export function releaseHeading(version: string | null, date: Date | null, locale = "en-US"): string {
  return [version === null ? null : `Version ${version}`, date === null ? null : dayOf(date, locale)]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function appTrust(app: AppDetails, locale = "en-US"): TrustFacts {
  const reach = app.permissions === null ? null : describeReach(app.permissions, app.id);
  const newest = app.releases[0];
  return {
    maker: {
      name: app.developer ?? "A developer who didn’t give a name",
      line: app.verified ? "Verified by Flathub" : "Not verified by Flathub",
      mark: app.verified ? "verified" : null,
    },
    signed: null,
    reach:
      app.permissions === null || reach === null
        ? { lines: [], cannot: null, known: false }
        : { lines: reach.lines, cannot: cannotReach(app.permissions, app.id), known: true },
    changed: newest
      ? { heading: releaseHeading(newest.version, newest.released === null ? null : new Date(newest.released * 1000), locale), notes: newest.notes }
      : null,
    users: app.installsLastMonth === null ? null : installsWords(app.installsLastMonth, locale),
  };
}

/**
 * Why getting `app` asks first (Get…): broad access, code that isn't open,
 * an app no longer maintained. Empty: one click gets it.
 */
export function askReasons(app: AppDetails): string[] {
  const broad = app.permissions === null ? [] : describeReach(app.permissions, app.id).broad;
  return [
    ...broad,
    ...(isProprietary(app.license) ? ["Its code isn’t open, so no one outside its maker can check it"] : []),
    ...(app.eol ? ["It’s no longer maintained, so it won’t get fixes"] : []),
  ];
}

export function appletTrust(entry: StoreApplet, locale = "en-US"): TrustFacts {
  const { manifest } = entry;
  const newest = entry.versions[0];
  const commands = commandsLine(manifest);
  return {
    // Dashi's review mark is Dashi's catalog's alone (merge.ts): another catalog's applet says whose list it is on.
    maker: {
      name: manifest.author.name,
      line: entry.reviewed ? "Reviewed by Dashi" : entry.from.builtIn ? "Not reviewed by Dashi" : `From ${entry.from.name} · not reviewed by Dashi`,
      mark: entry.reviewed ? "reviewed" : null,
    },
    signed: "Signed by its author. Dashi checks the signature before it installs.",
    reach: { lines: [...abilityLines(manifest), ...(commands ? [commands] : [])], cannot: cannotDo(manifest.permissions), known: true },
    changed: newest
      ? { heading: releaseHeading(newest.version, new Date(`${newest.released}T00:00:00Z`), locale), notes: newest.notes ? [newest.notes] : [] }
      : null,
    users: null,
  };
}
