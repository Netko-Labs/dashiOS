/** What the search (use-search.ts) asks the rows for: the sections the words find, and what a row's verbs may read. */

import type { Entry } from "../../shared/app-entries/index.ts";
import { iconPath } from "../../shared/apps/index.ts";
import { type ClockPrefs, usesHour24 } from "../../shared/time/index.ts";
import type { LauncherProps } from "../props.ts";
import type { filesStateFor, Section } from "../sections.ts";
import type { VerbContext } from "../verbs.ts";
import type { launcherIndex } from "./items.ts";
import type { Measures } from "./measures.ts";
import { buildSections } from "./rows.ts";
import type { LauncherState } from "./state.ts";

const ICONS = { calculator: iconPath("calculator"), files: iconPath("files"), software: iconPath("software"), command: iconPath("settings") };

/** What a row's verbs read: the windows, the actions, the person's aliases and keys, and what is kept in the Dock. */
export function verbContext(s: LauncherState, host: LauncherProps["host"]): VerbContext {
  const { world, prefs } = s;
  return {
    windows: world.windows,
    actions: world.actions,
    aliasOf: prefs.aliasOf,
    keyOf: prefs.keyOf,
    ...(host ? { pinned: (entry: Entry) => host.pinned(entry) } : {}),
  };
}

export interface FoundParts {
  props: LauncherProps;
  s: LauncherState;
  m: Measures;
  /** Answers in the Region's numbers and the person's clock (answers/). */
  clock: ClockPrefs;
  files: ReturnType<typeof filesStateFor>;
  index: ReturnType<typeof launcherIndex>;
}

/** The sections the words find, before what comes from outside and the agents is added. */
export function foundSections({ props, s, m, clock, files, index }: FoundParts): Section[] {
  const { query, scope, world, prefs } = s;
  return buildSections({
    answers: { locale: clock.locale, hour24: usesHour24(clock) },
    // In a scope its own rows show: the search's are the empty field's, which cost nothing.
    query: scope ? "" : query,
    entries: props.entries,
    recent: (props.recent ?? []).slice(0, m.listRows - 1),
    limits: { local: m.localRows, files: m.fileRows, allApps: m.allAppsRows },
    files,
    index,
    windows: world.windows,
    aliases: prefs.aliases,
    ...(props.ranking ? { signals: props.ranking } : {}),
    ...{ allApps: s.allApps, copied: s.copied, failed: s.failed, icons: ICONS },
  });
}
