// The battery monitor's app catalog (battery/lib/catalog.ts): built again when the installed apps change.
import { expect, test } from "bun:test";
import { catalogKeeper } from "../src/battery/lib/catalog.ts";
import type { AppCatalog } from "../src/shared/processes/index.ts";

const entry = (id: string) =>
  ({ id }) as Parameters<ReturnType<typeof catalogKeeper>>[0] extends infer E ? (E extends readonly (infer One)[] ? One : never) : never;

test("an app swapped for another, the list as long as before, builds the catalog again", () => {
  const built: string[][] = [];
  const keep = catalogKeeper((entries) => {
    built.push(entries.map((each) => each.id));
    return {} as AppCatalog;
  });
  expect(keep([entry("org.a"), entry("org.b")]).changed).toBe(true);
  expect(keep([entry("org.a"), entry("org.b")]).changed).toBe(false);
  // Same count, another app: it counted the list before, and missed this.
  expect(keep([entry("org.a"), entry("org.c")]).changed).toBe(true);
  expect(built).toEqual([
    ["org.a", "org.b"],
    ["org.a", "org.c"],
  ]);
});

test("with no list to read, the last catalog stays", () => {
  const catalog = {} as AppCatalog;
  const keep = catalogKeeper(() => catalog);
  expect(keep(undefined)).toEqual({ catalog: undefined, changed: false });
  keep([entry("org.a")]);
  expect(keep(undefined)).toEqual({ catalog, changed: false });
});
