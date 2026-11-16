/**
 * The agents' software tools over the Store's catalog on this computer
 * (D320, D325): search every source at once (Flathub, Fedora, Terra, each
 * COPR the person enabled, RPM Fusion) and say which source each result is
 * from; read a package's page; list the package apps installed; and ask to
 * install a package. An install is still asked of the person on screen every
 * time (critical-only rule, D260: installing system software changes the
 * system), and a package then asks for the password through polkit.
 *
 * An id names one source of one app: `flatpak:org.gimp.GIMP@flathub`,
 * `rpm:htop@fedora`, `rpm:helium-bin@copr:imput/helium`. A bare Flatpak id
 * (as 0.8's tools took) still means Flathub's.
 */

import { type CatalogEntry, COPR_NOTE, type Flathub, type Offer, type Source, tidy } from "../../shared/software/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { bounded, busy, type CatalogBackend, person } from "./software-backend.ts";

const ID = /^(flatpak|rpm):([A-Za-z0-9._+-]{1,160})@([A-Za-z0-9:/@._+-]{1,120})$/;

/** The id an agent passes back for one source of an entry. */
export const offerId = (offer: Pick<Offer, "kind" | "ref" | "source">): string => `${offer.kind}:${offer.ref}@${offer.source}`;

/** An id's parts, or null. */
export function parseOfferId(value: unknown): { kind: Offer["kind"]; ref: string; source: string } | null {
  if (typeof value !== "string") return null;
  const match = ID.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { kind: match[1] === "rpm" ? "rpm" : "flatpak", ref: match[2], source: match[3] };
}

/** A Flatpak id from an agent's id (`flatpak:org.x.Y@flathub`, or the bare id 0.8's tools took). */
export const flatpakId = (app: string): string => {
  const parsed = parseOfferId(app);
  return parsed?.kind === "flatpak" ? parsed.ref : app;
};

const sourceOf = (sources: readonly Source[], id: string): Source | undefined => sources.find((source) => source.id === id);

/** One source of a result, as the agent reads it. */
type OfferWords = ReturnType<typeof describeOffer>;

function describeOffer(sources: readonly Source[], offer: Offer) {
  const source = sourceOf(sources, offer.source);
  return {
    id: offerId(offer),
    source: source?.label ?? offer.source,
    sourceKind: source?.kind ?? "repo",
    ...(source?.kind === "copr" && !source.dashi ? { note: COPR_NOTE } : {}),
    sandboxed: offer.kind === "flatpak",
    verified: offer.verified,
    needsPassword: offer.kind === "rpm",
    installed: offer.installed,
    ...(offer.version ? { version: offer.version } : {}),
  };
}

/** A search result: the entry, its default source first, the others after. */
export function describeEntry(
  sources: readonly Source[],
  entry: CatalogEntry,
): Partial<OfferWords> & { name: string; summary: string; kind: string; otherSources?: OfferWords[] } {
  const [first, ...rest] = entry.offers;
  return {
    name: tidy(entry.name, 80),
    summary: tidy(entry.summary, 160),
    kind: entry.kind === "tool" ? "command-line tool" : "app",
    ...(first ? describeOffer(sources, first) : {}),
    ...(rest.length > 0 ? { otherSources: rest.map((offer) => describeOffer(sources, offer)) } : {}),
  };
}

export async function searchCatalog(index: CatalogBackend["index"], query: string, limit: number): Promise<{ results: unknown[]; flathubKnown: boolean }> {
  const data = await index.ready();
  const flathubKnown = data.entries.some((entry) => entry.offers.some((offer) => offer.kind === "flatpak"));
  const found = index.search(query, limit);
  // Apps first; tools only when the words name one (their package name).
  const entries = [...found.apps, ...found.tools].slice(0, limit);
  return { results: entries.map((entry) => describeEntry(data.sources, entry)), flathubKnown };
}

/** The entry and the offer an id names, from the catalog. */
export async function findOffer(
  index: CatalogBackend["index"],
  id: { kind: Offer["kind"]; ref: string; source: string },
): Promise<{ entry: CatalogEntry; offer: Offer; sources: Source[] } | null> {
  const data = await index.ready();
  const entry = index.entryFor(id.kind, id.ref);
  const offer = entry?.offers.find((each) => each.kind === id.kind && each.ref === id.ref && each.source === id.source);
  return entry && offer ? { entry, offer, sources: data.sources } : null;
}

/** The confirm sheet's second line for a package. */
export function packageDetail(sources: readonly Source[], offer: Offer): string {
  const source = sourceOf(sources, offer.source);
  const from = source?.kind === "fedora" ? "Fedora" : (source?.label ?? offer.source);
  const copr = source?.kind === "copr" && !source.dashi ? ` (${COPR_NOTE.toLowerCase()})` : "";
  return `The ${offer.ref} package from ${from}${copr}. Packages aren’t sandboxed: it runs with your account’s full access. You’ll be asked for your password.`;
}

/** The package apps on this computer, from the catalog. */
export async function installedPackages(index: CatalogBackend["index"]): Promise<unknown[]> {
  const data = await index.ready();
  return data.entries
    .filter((entry) => entry.kind === "app" && entry.offers.some((offer) => offer.kind === "rpm" && offer.installed))
    .slice(0, 200)
    .map((entry) => {
      const offer = entry.offers.find((each) => each.kind === "rpm" && each.installed);
      return {
        id: offer ? offerId(offer) : null,
        name: tidy(entry.name, 80),
        source: offer ? (sourceOf(data.sources, offer.source)?.label ?? offer.source) : null,
      };
    });
}

/** A package from Fedora, Terra or a COPR: the person's sheet, then PackageKit (which asks for the password). */
export async function requestPackage(b: Partial<CatalogBackend>, id: NonNullable<ReturnType<typeof parseOfferId>>, ctx: RunContext): Promise<ToolResult> {
  if (!b.index || !b.packages) return toolError("Packages can't be installed from here.");
  const found = await findOffer(b.index, id);
  if (!found) return toolError("That package isn't in the sources that are on. Look it up again with search_software.");
  const name = person(found.entry.name, 60);
  if (found.offer.installed) return text(`“${name}” is already installed.`);
  if (busy.working) return toolError("The Store is already installing or updating something for the person; try again when that is done.");
  const yes = await ctx.confirm({
    summary: `install “${name}” (${offerId(found.offer)})`,
    detail: packageDetail(found.sources, found.offer),
    action: "Install",
  });
  if (!yes) return toolError(`The person did not allow “${name}” to be installed. Don't ask again unless they agree.`);
  busy.working = true;
  ctx.status(`Installing ${name}`);
  const result = await bounded(b.packages.install(found.offer, () => ctx.status(`Installing ${name}`)).finally(() => (busy.working = false)));
  if (!result.done) return text(`The person said yes and “${name}” is still installing; list_installed_software shows when it is done.`);
  if (result.value.ok) return text(`“${name}” is installed from ${describeEntry(found.sources, { ...found.entry, offers: [found.offer] }).source}.`);
  return toolError(
    result.value.cancelled
      ? `The password wasn't given, so “${name}” wasn't installed.`
      : `“${name}” could not be installed: ${tidy(result.value.message, 300)}`,
  );
}

/** search_software over every source; Flathub's web search fills in until its catalog file has arrived (the first day). */
export async function searchEverySource(b: Partial<CatalogBackend> & { catalog: Pick<Flathub, "search"> }, query: string, limit: number): Promise<ToolResult> {
  if (!b.index) return toolError("The catalog isn't here.");
  const found = await searchCatalog(b.index, query, limit);
  if (found.flathubKnown) return json({ results: found.results });
  const web = await b.catalog.search(query, 1, limit).catch(() => null);
  const extra = (web?.value.apps ?? []).map((app) => ({
    name: person(app.name),
    summary: person(app.summary, 160),
    kind: "app",
    id: offerId({ kind: "flatpak", ref: app.id, source: "flathub" }),
    source: "Flathub",
    sourceKind: "flathub",
    sandboxed: true,
    verified: app.verified,
    needsPassword: false,
  }));
  return json({ results: [...found.results, ...extra].slice(0, limit) });
}
