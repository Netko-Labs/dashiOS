/**
 * Why a change failed, in Dashi's words: the tool's own text (flatpak,
 * PackageKit, the applet verifier) is matched against the failures people
 * actually meet, and becomes one plain sentence with what to do next. The
 * tool's text is kept as the details, shown only when asked for (PA-6).
 */

export interface PlainFailure {
  /** What happened and what to do, in a sentence or two. */
  message: string;
  /** The tool's own words, behind "Details"; null when there is nothing more to say. */
  details: string | null;
}

const KNOWN: ReadonlyArray<[RegExp, string]> = [
  [/no space left|not enough (disk )?space|insufficient space|ENOSPC/i, "There isn't enough free space. Make some room, then try again."],
  [
    /could not resolve|couldn't resolve|unable to connect|can't be reached|network is unreachable|timed out|connection (refused|reset)|offline/i,
    "The network isn't answering. Check the connection, then try again.",
  ],
  [/not authori[sz]ed|authentication|polkit|dismissed|permission denied/i, "Your password wasn't given, so nothing changed."],
  [/\block(ed)?\b|another (transaction|update|instance)|is busy|already running/i, "Another update is running. Try again when it finishes."],
  [/already installed/i, "It's already installed."],
  [/not installed/i, "It isn't installed any more."],
  [/no remote refs|nothing matches|no such ref|not found in remote/i, "Flathub doesn't offer it any more."],
  [/signature|not signed|isn't signed|key doesn't match|signed by/i, "Its signature doesn't match. Dashi didn't install it, to keep you safe."],
  [/sha256|hash|size is wrong|not what the index lists/i, "What arrived isn't what the catalog lists. Dashi didn't install it, to keep you safe."],
  [/no version for this dashi|needs a newer dashi/i, "It needs a newer Dashi."],
];

/** The tool's text, matched to a known failure; anything else is said plainly with the text as details. */
export function plainFailure(text: string): PlainFailure {
  const raw = text.trim();
  const known = KNOWN.find(([pattern]) => pattern.test(raw));
  if (known) return { message: known[1], details: raw === "" ? null : raw };
  return { message: "It stopped before it finished. Try again, or look at the details.", details: raw === "" ? null : raw };
}
