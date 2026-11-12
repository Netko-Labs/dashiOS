/**
 * Where Software is: the page open (nav.ts), its history, and the words in
 * the toolbar's search field. Typing a search reaches the page after a short
 * pause; on Installed the words filter what is installed instead, so no
 * search page is made for them.
 */

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { back, goTo, type Nav, type Page, search, startPage } from "./nav.ts";

const SEARCH_DELAY_MS = 300;

export interface WindowNavigation {
  nav: Nav;
  setNav: Dispatch<SetStateAction<Nav>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  /** On Installed the query filters what is installed; anywhere else it searches. */
  filtering: boolean;
  /** Opens a page from the sidebar or a link; the search field is cleared. */
  go(page: Page): void;
  /** Back one page, with the search field showing that page's search (if any). */
  goBack(): void;
}

/** `initialQuery`: open on a search for these words; `initialPage`: on a sidebar place. */
export function useNavigation(initialQuery: string, initialPage: string | undefined): WindowNavigation {
  const [nav, setNav] = useState<Nav>(() => startPage(initialPage));
  const [query, setQuery] = useState(initialQuery);
  const filtering = nav.page.kind === "installed";
  useEffect(() => {
    if (filtering) return;
    const timer = setTimeout(() => setNav((now) => search(now, query)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, filtering]);

  const go = (page: Page): void => {
    setQuery("");
    setNav(goTo(page));
  };
  const goBack = (): void => {
    const next = back(nav);
    setNav(next);
    setQuery(next.page.kind === "search" ? next.page.query : "");
  };
  return { nav, setNav, query, setQuery, filtering, go, goBack };
}
