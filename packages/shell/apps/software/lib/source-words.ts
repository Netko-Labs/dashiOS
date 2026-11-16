/**
 * What the Store says about where an app comes from: the short line on a
 * result ("Flathub · verified", "Fedora package", "Terra", "imput/helium ·
 * Community build, not reviewed by Fedora"), the reason under a page's button,
 * who vouches for it, and how it runs. Pure, so the views and their tests
 * agree.
 */

import { type CatalogEntry, COPR_NOTE, type Offer, type Source } from "../../../src/shared/software/index.ts";

export const sourceOf = (sources: readonly Source[], offer: Pick<Offer, "source">): Source | undefined => sources.find((each) => each.id === offer.source);

/** The source's name as a result row says it. */
export function offerLabel(sources: readonly Source[], offer: Offer): string {
  const source = sourceOf(sources, offer);
  if (offer.kind === "flatpak") return offer.verified ? "Flathub · verified" : "Flathub, community build";
  if (!source) return "A package";
  if (source.kind === "fedora") return "Fedora package";
  if (source.kind === "copr" && !source.dashi) return `${source.label} · ${COPR_NOTE}`;
  return source.label;
}

/** A result's second line: its source, then "also in Fedora, Terra" when others have it. */
export function sourceLine(sources: readonly Source[], entry: CatalogEntry): string {
  const [first, ...rest] = entry.offers;
  if (!first) return "";
  const others = [...new Set(rest.map((offer) => sourceOf(sources, offer)?.label ?? ""))].filter(Boolean);
  return others.length > 0 ? `${offerLabel(sources, first)} · also in ${others.join(", ")}` : offerLabel(sources, first);
}

/** Why the page uses this source, in one line under its button (D321). */
export function whyLine(sources: readonly Source[], entry: CatalogEntry, offer: Offer): string {
  const name = sourceOf(sources, offer)?.label ?? "this source";
  if (offer.installed) return `Installed from ${name}.`;
  if (entry.offers.length === 1) return `From ${name}: it is the only source that has it.`;
  if (offer !== entry.offers[0]) return `From ${name}, as you chose.`;
  if (offer.kind === "flatpak") return "From Flathub: apps there run in a sandbox and update without a password.";
  if (sourceOf(sources, offer)?.kind === "fedora") return "From Fedora: Fedora builds it from source and signs it.";
  return `From ${name}: the first source on this computer that has it.`;
}

export interface MadeBy {
  /** "Packaged by Fedora", "Built by Terra", "imput/helium". */
  name: string;
  line: string;
}

/** Who vouches for a package (the trust card's "Made by" row for an RPM). */
export function packageMaker(sources: readonly Source[], offer: Offer): MadeBy {
  const source = sourceOf(sources, offer);
  switch (source?.kind) {
    case "fedora":
      return { name: "Packaged by Fedora", line: "Built from source by a Fedora packager and signed with Fedora’s key." };
    case "terra":
      return { name: "Built by Terra", line: "Terra (Fyra Labs) builds packages Fedora doesn’t carry and signs them with its key. Fedora didn’t review them." };
    case "copr":
      return source.dashi
        ? { name: "Made by Dashi", line: "Part of Dashi, from Dashi’s own COPR." }
        : { name: source.label, line: `${COPR_NOTE}. Anyone can publish a COPR; you turned this one on yourself.` };
    default:
      return { name: source?.label ?? "A repository", line: "Added on this computer. Nothing is known about who built it." };
  }
}

/** The Runs row for a package: never sandboxed. */
export const packageRuns = { name: "With your account’s full access", line: "Packages aren’t sandboxed: it can do everything your account can." } as const;

/** The Get… sheet's message for a package. */
export function packageAsk(sources: readonly Source[], offer: Offer, tool: boolean): string {
  const source = sourceOf(sources, offer);
  const from = source?.kind === "fedora" ? "Fedora" : (source?.label ?? "this repository");
  const copr = source?.kind === "copr" && !source.dashi ? ` ${source.label} is a community build, not reviewed by Fedora.` : "";
  const what = tool ? "It runs in Terminal with" : "It runs with";
  return `From ${from}.${copr} ${what} your account’s full access: packages aren’t sandboxed. You’ll be asked for your password.`;
}
