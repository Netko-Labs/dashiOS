import { expect, test } from "bun:test";
import { readContext } from "../src/handoff-shell.tsx";

const page = async () => ({ url: "http://signin.localhost:8443/", title: "Sign in to the test site" });

test("Helium, which Dashi names Browser, is asked for its page by its app id", async () => {
  const context = await readContext({
    window: async () => ({ id: 1, app: "Browser", appId: "helium", title: "Sign in to the test site - Helium" }),
    page,
    selection: async () => null,
  });
  expect(context.window).toEqual({
    id: 1,
    app: "Browser",
    title: "Sign in to the test site - Helium",
    site: "signin.localhost",
    url: "http://signin.localhost:8443/",
  });
});

test("another app isn't asked for a page; a selection is kept, a blank one isn't", async () => {
  let asked = false;
  const notes = await readContext({
    window: async () => ({ id: 2, app: "Notes", appId: "dev.dashi.notes", title: "Groceries" }),
    page: async () => {
      asked = true;
      return null;
    },
    selection: async () => "Thursday 7am",
  });
  expect(asked).toBe(false);
  expect(notes).toEqual({ window: { id: 2, app: "Notes", title: "Groceries", site: null, url: null }, selection: "Thursday 7am" });
  const blank = await readContext({ window: async () => null, page, selection: async () => "  \n" });
  expect(blank).toEqual({ window: null, selection: null });
});
