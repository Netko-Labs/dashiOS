import { expect, test } from "bun:test";
import { loadRecommended, summaryOf } from "../apps/software/recommended.tsx";
import { CatalogError } from "../src/shared/software/flathub.ts";
import { RECOMMENDED_APPS } from "../src/shared/software/recommended.ts";
import type { AppDetails } from "../src/shared/software/types.ts";

const details = (id: string): AppDetails => ({
  ...summaryOf({ id, name: `${id} from Flathub`, summary: "From the catalog" }),
  icon: `https://dl.flathub.org/media/${id}.png`,
  verified: true,
  description: ["Long words"],
  screenshots: [],
  homepage: null,
  version: null,
  released: null,
  runtime: null,
  eol: false,
  downloadSize: null,
  installedSize: null,
  categories: [],
  releases: [],
  permissions: null,
});

test("the shelf keeps Dashi's name and line, and takes the catalog's icon and verified mark where it answers", async () => {
  const [vlc, mpv] = RECOMMENDED_APPS;
  if (!vlc || !mpv) throw new Error("the list is empty");
  const catalog = {
    details: async (id: string) => {
      if (id === mpv.id) throw new CatalogError("offline", "Flathub can't be reached.");
      return { value: details(id), stale: id === vlc.id };
    },
  };
  const { value, stale } = await loadRecommended(catalog, [vlc, mpv]);
  expect(stale).toBe(true);
  expect(value.map((app) => app.id)).toEqual([vlc.id, mpv.id]);
  expect(value[0]).toMatchObject({ name: vlc.name, summary: vlc.summary, verified: true, icon: `https://dl.flathub.org/media/${vlc.id}.png` });
  expect(value[0]).not.toHaveProperty("description");
  expect(value[1]).toEqual(summaryOf(mpv));
});
