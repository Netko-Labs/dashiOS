/**
 * Asking a GNOME search provider (`org.gnome.Shell.SearchProvider2`) over
 * the session bus, as GNOME Shell does: the result ids for the words typed
 * (`GetInitialResultSet`), what a few of them are called
 * (`GetResultMetas`), and opening the one chosen (`ActivateResult`). Results
 * only: a provider takes no arguments and gives no inline answer. Its
 * replies are untrusted: anything that isn't the shape the interface says is
 * dropped. D-Bus activation starts a provider that isn't running.
 */

import type { Outcome } from "../actions/types.ts";
import type { SlowSource } from "../launcher/budget.ts";
import type { SlowRow } from "../launcher/extension-rows.ts";
import { type CallSpec, Variant } from "../shared/dbus/index.ts";
import type { ProviderInfo } from "./ini.ts";

export const SEARCH_PROVIDER = "org.gnome.Shell.SearchProvider2";

/** Results asked about at once: the launcher shows three of each provider. */
export const RESULTS = 3;
/** A provider that takes longer than this is given up on (the launcher calls it slow at 80 ms). */
export const CALL_TIMEOUT_MS = 3_000;

export interface ProviderBus {
  call(spec: CallSpec, timeoutMs?: number): Promise<unknown[]>;
}

export interface ResultMeta {
  id: string;
  name: string;
  description?: string;
}

const text = (value: unknown): string | null => {
  const inner = value instanceof Variant ? value.value : value;
  return typeof inner === "string" ? inner.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, " ").trim() : null;
};

/** `GetResultMetas`'s `aa{sv}`: each result's id, name, and description, for the ids asked about only. */
export function parseMetas(value: unknown, asked: readonly string[]): ResultMeta[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((meta): ResultMeta[] => {
    if (!(meta instanceof Map)) return [];
    const id = text(meta.get("id"));
    const name = text(meta.get("name"));
    if (id === null || name === null || name === "" || !asked.includes(id)) return [];
    const description = text(meta.get("description"));
    return [{ id, name: name.slice(0, 120), ...(description ? { description: description.slice(0, 120) } : {}) }];
  });
}

/** The words a query is to a provider. */
export const termsOf = (query: string): string[] => query.trim().split(/\s+/).filter(Boolean).slice(0, 8);

export interface ProviderApp {
  /** The app's name and icon, as its desktop entry has them. */
  name: string;
  icon: string;
}

/** A provider as one of the launcher's slow sources (launcher/budget.ts): asked per query, against 80 ms. */
export function providerSource(info: ProviderInfo, app: ProviderApp, bus: () => Promise<ProviderBus>): SlowSource<SlowRow> {
  const call = async (member: string, signature: string, body: unknown[]): Promise<unknown[]> =>
    (await bus()).call({ destination: info.busName, path: info.objectPath, interface: SEARCH_PROVIDER, member, signature, body }, CALL_TIMEOUT_MS);
  return {
    id: `${info.busName}${info.objectPath}`,
    label: app.name,
    ask: async (query) => {
      const terms = termsOf(query);
      if (terms.length === 0) return [];
      const [found] = await call("GetInitialResultSet", "as", [terms]);
      const ids = Array.isArray(found) ? found.filter((id): id is string => typeof id === "string").slice(0, RESULTS) : [];
      if (ids.length === 0) return [];
      const [metas] = await call("GetResultMetas", "as", [ids]);
      return parseMetas(metas, ids).map(
        (meta): SlowRow => ({
          id: meta.id,
          title: meta.name,
          ...(meta.description ? { detail: meta.description } : {}),
          icon: app.icon,
          run: async (): Promise<Outcome> => {
            await call("ActivateResult", "sasu", [meta.id, terms, 0]);
            return { ok: true, text: `${meta.name} is open in ${app.name}.` };
          },
        }),
      );
    },
  };
}
