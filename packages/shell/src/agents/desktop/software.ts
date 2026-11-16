/**
 * Software for agents: reading the catalog and what is installed, and *asking*
 * for installs and updates. An install or update always goes through
 * `ctx.confirm`, the shell's own sheet, every time and whatever the agent was
 * allowed before; the person's answer is never kept. The work itself is the
 * Software app's (shared/software/manager.ts), so an agent's install is the one the
 * person would have made. Only user installs of Flathub apps are requested
 * here; system updates go through PackageKit and polkit, which asks for the
 * person's password on screen.
 */

import { type AppDetails, formatBytes, tidy } from "../../shared/software/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import { backend, bounded, busy, installedIds, person, type SoftwareBackend, unavailable } from "./software-backend.ts";

import { describeEntry, findOffer, flatpakId, installedPackages, parseOfferId, requestPackage, searchEverySource } from "./software-catalog.ts";

export async function searchSoftware(call: Extract<Call, { name: "search_software" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking for apps");
  const b = backend(ctx);
  if (b.index) return searchEverySource(b, call.query, call.limit);
  try {
    const [found, have] = await Promise.all([b.catalog.search(call.query, 1, call.limit), installedIds(b)]);
    return json({
      results: found.value.apps.slice(0, call.limit).map((app) => ({
        id: app.id,
        name: person(app.name),
        summary: person(app.summary, 160),
        developer: app.developer === null ? null : person(app.developer),
        verified: app.verified,
        installed: have.has(app.id),
      })),
      ...(found.stale ? { note: "Flathub could not be reached; these results are from an earlier search." } : {}),
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function getSoftware(call: Extract<Call, { name: "get_software" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Reading an app's page");
  const b = backend(ctx);
  const parsed = parseOfferId(call.app);
  if (parsed?.kind === "rpm" && b.index) {
    const found = await findOffer(b.index, parsed);
    if (!found) return toolError("That package isn't in the sources that are on. Look it up again with search_software.");
    const offers = [found.offer, ...found.entry.offers.filter((each) => each !== found.offer)];
    return json({ ...describeEntry(found.sources, { ...found.entry, offers }), license: found.entry.license });
  }
  try {
    const [page, have] = await Promise.all([b.catalog.details(flatpakId(call.app)), installedIds(b)]);
    const app = page.value;
    return json({
      id: app.id,
      name: person(app.name),
      summary: person(app.summary, 200),
      description: tidy(app.description.join(" "), 1500),
      developer: app.developer === null ? null : person(app.developer),
      verified: app.verified,
      license: app.license,
      version: app.version,
      downloadSize: app.downloadSize,
      installedSize: app.installedSize,
      homepage: app.homepage,
      endOfLife: app.eol,
      installed: have.has(app.id),
      source: "Flathub",
      sandboxed: true,
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function listInstalledSoftware(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at the apps installed");
  try {
    const b = backend(ctx);
    const apps = await b.manager.installed();
    const packages = b.index ? await installedPackages(b.index).catch(() => []) : [];
    return json({
      packages,
      apps: apps.map((app) => ({
        id: app.id,
        name: person(app.name),
        version: app.version,
        installation: app.installation,
        source: app.origin,
        size: app.size,
      })),
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function listSoftwareUpdates(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking for updates");
  const b = backend(ctx);
  const [apps, system] = await Promise.allSettled([b.manager.flatpakUpdates(), b.manager.systemUpdates()]);
  const notes: string[] = [];
  if (apps.status === "rejected") notes.push(`App updates could not be checked: ${reason(apps.reason)}`);
  if (system.status === "rejected") notes.push(`System updates could not be checked: ${reason(system.reason)}`);
  return json({
    apps:
      apps.status === "fulfilled"
        ? apps.value.map((u) => ({ id: u.id, name: person(u.name), version: u.version, installation: u.installation, downloadSize: u.downloadSize }))
        : [],
    system:
      system.status === "fulfilled"
        ? system.value.updates.slice(0, 100).map((u) => ({ package: u.name, version: u.version, kind: u.kind, repository: u.repo }))
        : [],
    restartLikelyNeeded: system.status === "fulfilled" ? system.value.restartCauses.length > 0 : false,
    ...(notes.length > 0 ? { notes } : {}),
  });
}

const reason = (error: unknown): string => (error instanceof Error ? tidy(error.message, 200) : "unknown error");

/** The sheet's second line: who made it, whether Flathub verified them, and what it takes. */
export function installDetail(app: AppDetails): string {
  const who = app.developer === null ? "Developer unknown" : `By ${person(app.developer, 60)}${app.verified ? " (verified)" : " (not verified)"}`;
  const size = app.downloadSize !== null ? `, ${formatBytes(app.downloadSize)} to download` : "";
  return `${who}${size}. It is installed for you only, from Flathub, and can be removed in the Store.`;
}

export async function requestInstall(call: Extract<Call, { name: "request_software_install" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking up an app to install");
  const b = backend(ctx);
  const parsed = parseOfferId(call.app);
  if (parsed?.kind === "rpm") return requestPackage(b, parsed, ctx);
  let app: AppDetails;
  try {
    app = (await b.catalog.details(flatpakId(call.app))).value;
  } catch (error) {
    return unavailable(error);
  }
  if ((await installedIds(b)).has(app.id)) return text(`“${person(app.name)}” is already installed.`);
  if (busy.working) return toolError("Software is already installing or updating something for the person; try again when that is done.");
  const name = person(app.name, 60);
  const yes = await ctx.confirm({ summary: `install “${name}” (${app.id})`, detail: installDetail(app), action: "Install" });
  if (!yes) return toolError(`The person did not allow “${name}” to be installed. Don't ask again unless they agree.`);
  busy.working = true;
  ctx.status(`Installing ${name}`);
  const job = b.manager.install(app.id, (progress) =>
    ctx.status(progress.fraction === null ? `Installing ${name}` : `Installing ${name}, ${Math.round(progress.fraction * 100)}%`),
  );
  const finished = job.finally(() => {
    busy.working = false;
  });
  try {
    const result = await bounded(finished);
    if (!result.done) return text(`The person said yes and “${name}” is still installing; list_installed_software shows when it is done.`);
    return result.value.ok ? text(`“${name}” is installed.`) : toolError(`“${name}” could not be installed: ${tidy(result.value.message, 300)}`);
  } catch (error) {
    return unavailable(error);
  }
}

export async function requestUpdate(call: Extract<Call, { name: "request_software_update" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking for updates to install");
  const b = backend(ctx);
  try {
    if (call.target === "system") return await updateSystem(b, ctx);
    const waiting = await b.manager.flatpakUpdates();
    const chosen = call.target === "apps" ? waiting : waiting.filter((update) => update.id === (call.target as { app: string }).app);
    if (chosen.length === 0)
      return text(call.target === "apps" ? "No app updates are waiting." : "That app has no update waiting; list_software_updates shows what does.");
    if (busy.working) return toolError("Software is already installing or updating something for the person; try again when that is done.");
    const names = chosen
      .slice(0, 4)
      .map((update) => `“${person(update.name, 40)}”`)
      .join(", ");
    const yes = await ctx.confirm({
      summary: chosen.length === 1 ? `update “${person(chosen[0]?.name ?? "", 60)}”` : `update ${chosen.length} apps`,
      detail: `${names}${chosen.length > 4 ? ` and ${chosen.length - 4} more` : ""}. The apps keep their data. System-wide apps ask for your password.`,
      action: "Update",
    });
    if (!yes) return toolError("The person did not allow the update. Don't ask again unless they agree.");
    busy.working = true;
    const run = async (): Promise<string[]> => {
      const failures: string[] = [];
      const installations = [...new Set(chosen.map((update) => update.installation))];
      for (const installation of installations) {
        const only = call.target === "apps" ? undefined : chosen[0]?.id;
        ctx.status("Updating apps");
        const outcome = await b.manager.updateFlatpak(installation, only, () => {});
        if (!outcome.ok) failures.push(tidy(outcome.message, 200));
      }
      return failures;
    };
    const result = await bounded(run().finally(() => (busy.working = false)));
    if (!result.done) return text("The person said yes and the updates are still going; list_software_updates shows what is left.");
    return result.value.length === 0
      ? text(`${chosen.length === 1 ? "The app is" : "The apps are"} updated.`)
      : toolError(`Some updates failed: ${result.value.join(" ")}`);
  } catch (error) {
    return unavailable(error);
  }
}

async function updateSystem(b: SoftwareBackend, ctx: RunContext): Promise<ToolResult> {
  const { updates, restartCauses } = await b.manager.systemUpdates();
  if (updates.length === 0) return text("The system is up to date.");
  if (busy.working) return toolError("Software is already installing or updating something for the person; try again when that is done.");
  const restart =
    restartCauses.length > 0
      ? ` A restart will be needed afterwards (${restartCauses
          .slice(0, 3)
          .map((u) => tidy(u.name, 30))
          .join(", ")}).`
      : "";
  const yes = await ctx.confirm({
    summary: `install ${updates.length} system update${updates.length === 1 ? "" : "s"}`,
    detail: `They change the system's own software, and you will be asked for your password.${restart}`,
    action: "Update",
  });
  if (!yes) return toolError("The person did not allow the system update. Don't ask again unless they agree.");
  busy.working = true;
  ctx.status("Updating the system");
  const result = await bounded(b.manager.updateSystem(() => {}).finally(() => (busy.working = false)));
  if (!result.done) return text("The person said yes and the system update is still going; list_software_updates shows what is left.");
  if (!result.value.ok) return toolError(`The system update did not finish: ${tidy(result.value.message, 300)}`);
  const needs = await b.manager.needsRestart();
  return text(needs ? "The system is updated. A restart is needed to finish; the person restarts when they choose." : "The system is updated.");
}
