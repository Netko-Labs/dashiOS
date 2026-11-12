/** The apps processes are named by, kept between looks and built again when the installed list changes. */

import { type AppCatalog, catalogFrom } from "../../shared/processes/index.ts";

type Entries = Parameters<typeof catalogFrom>[0];

/**
 * Gives the catalog for a list of installed apps, and whether it was built again: when an app
 * was installed or removed since the last look (the list's ids changed, even at the same
 * length). With no list, the last catalog stays.
 */
export function catalogKeeper(
  build: (entries: Entries) => AppCatalog = catalogFrom,
): (entries: Entries | undefined) => { catalog: AppCatalog | undefined; changed: boolean } {
  let catalog: AppCatalog | undefined;
  let listed = "";
  return (entries) => {
    const ids = entries?.map((entry) => entry.id).join("\n") ?? "";
    if (!entries || ids === listed) return { catalog, changed: false };
    catalog = build(entries);
    listed = ids;
    return { catalog, changed: true };
  };
}
