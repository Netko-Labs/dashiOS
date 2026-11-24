/** The omnibox's state in a chooser, as Files' window keeps it: the text being edited, each edit's session, the suggestions. */

import { useCallback, useState } from "react";
import type { Suggestions } from "../../omnibox-props.ts";

export interface OmniboxState {
  editing: string | null;
  session: number;
  edit: (text: string | null) => void;
  suggestions: Suggestions | null;
  setSuggestions: (suggestions: Suggestions | null) => void;
}

export function useOmnibox(): OmniboxState {
  const [editing, setEditing] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const edit = useCallback((text: string | null) => {
    if (text !== null) setSession((n) => n + 1);
    setEditing(text);
  }, []);
  return { editing, session, edit, suggestions, setSuggestions };
}
