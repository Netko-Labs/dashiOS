/**
 * Quicklinks (store-v2 frame L9): the person's own addresses with a
 * `{Query}` in them, kept in settings.json beside the aliases
 * (`launcher.quicklinks`), each an action at `dashi://quicklink/<id>`.
 * Choosing one asks for its words in the field (the chip names it) and
 * opens the address with them; its alias and key are set from ❖K as any
 * command's. "New Quicklink" asks for a name and an address; "Add a
 * Quicklink from the Library" offers a few made ones; "Remove a Quicklink"
 * takes one away. Search the Web is there until the person changes the list.
 *
 * A quicklink, like any action that takes words, can be a fallback: a row
 * when nothing matches (L13), in the order the person chose them
 * (`launcher.fallbacks`; prefs.ts).
 */

import { type ActionDef, type ActionSource, failed, formatAddress, invalid, type Outcome, ok, type PickRow, ready } from "../actions/index.ts";
import { fillQuery, isUrl, QUICKLINK_LIBRARY, type Quicklink, type QuicklinkStore, quicklinkId } from "./quicklink-list.ts";

export const quicklinkAddress = (id: string): string => formatAddress(["quicklink", id]);

export interface QuicklinkDeps {
  store: QuicklinkStore;
  open(target: string): Promise<Outcome>;
}

const base = (address: string, title: string, words: readonly string[]): Omit<ActionDef, "kind" | "check" | "properties"> => ({
  address,
  title,
  description: "",
  keywords: { en: ["quicklink", "link", ...words] },
  scope: null,
  readOnly: false,
  destructive: false,
  who: "person",
  source: "quicklinks",
});

/** One quicklink as an action: its words asked in the field when its address has a `{Query}`. */
function linkAction(link: Quicklink, deps: QuicklinkDeps): ActionDef {
  const takesWords = link.url.includes("{Query}");
  return {
    ...base(quicklinkAddress(link.id), link.name, [link.url.replace(/^https:\/\/(www\.)?/, "").split("/")[0] ?? ""]),
    kind: "open",
    properties: takesWords ? { query: { type: "string", description: link.name } } : {},
    ...(takesWords ? { required: ["query"] } : {}),
    check: (args) => {
      const words = typeof args.query === "string" ? args.query : "";
      if (takesWords && !words.trim()) return invalid("Type what to look for");
      return ready(() => deps.open(fillQuery(link.url, words)));
    },
  };
}

export class QuicklinkSource implements ActionSource {
  readonly id = "quicklinks";
  constructor(private readonly deps: QuicklinkDeps) {}

  subscribe = (listener: () => void): (() => void) => this.deps.store.subscribe(listener);

  actions = (): readonly ActionDef[] => {
    const { store } = this.deps;
    const links = store.list();
    return [...links.map((link) => linkAction(link, this.deps)), this.create(), this.fromLibrary(), ...(links.length > 0 ? [this.remove()] : [])];
  };

  private create(): ActionDef {
    const { store } = this.deps;
    return {
      ...base("dashi://quicklink/new", "New Quicklink", ["new", "create", "add"]),
      kind: "run",
      properties: {
        name: { type: "string", description: "Its name, like Search GitHub" },
        url: { type: "string", description: "Its address, with {Query} for the words" },
      },
      required: ["name", "url"],
      check: (args) => {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        const given = typeof args.url === "string" ? args.url.trim() : "";
        const url = /^[a-z]+:\/\//.test(given) ? given : `https://${given}`;
        if (!name || name.length > 60) return invalid("A name, 60 letters at most");
        if (!isUrl(url)) return invalid("An https:// address");
        return ready(async () => {
          const links = store.list();
          store.set([
            ...links,
            {
              id: quicklinkId(
                name,
                links.map((each) => each.id),
              ),
              name,
              url,
            },
          ]);
          return ok(`${name} is a quicklink now`);
        });
      },
    };
  }

  private pick(address: string, title: string, words: readonly string[], rows: () => PickRow[], choose: (row: PickRow) => Outcome): ActionDef {
    return {
      ...base(address, title, words),
      kind: "pick",
      properties: {},
      check: () =>
        ready(async () => ({
          ok: true,
          text: title,
          show: {
            kind: "pick",
            title,
            ask: async (query) => rows().filter((row) => row.title.toLowerCase().includes(query.trim().toLowerCase())),
            choose: async (row) => choose(row),
          },
        })),
    };
  }

  private fromLibrary(): ActionDef {
    const { store } = this.deps;
    return this.pick(
      "dashi://quicklink/library",
      "Add a Quicklink from the Library",
      ["library", "add"],
      () =>
        QUICKLINK_LIBRARY.filter((link) => !store.list().some((each) => each.id === link.id)).map((link) => ({
          id: link.id,
          title: link.name,
          detail: link.url,
        })),
      (row) => {
        const link = QUICKLINK_LIBRARY.find((each) => each.id === row.id);
        if (!link) return failed("That one isn't in the library");
        store.set([...store.list(), link]);
        return ok(`${link.name} is a quicklink now`);
      },
    );
  }

  private remove(): ActionDef {
    const { store } = this.deps;
    return this.pick(
      "dashi://quicklink/remove",
      "Remove a Quicklink",
      ["remove", "delete"],
      () => store.list().map((link) => ({ id: link.id, title: link.name, detail: link.url })),
      (row) => {
        store.set(store.list().filter((link) => link.id !== row.id));
        return ok(`${row.title} is gone`);
      },
    );
  }
}
