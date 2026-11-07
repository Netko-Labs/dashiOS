/**
 * The words under the expression line: what it works out to ("= 15,340"),
 * why it can't be worked out ("Can't divide by 0"), or for a moment what just
 * happened ("Copied"). Pure; the result's number comes formatted.
 */

import type { Outcome } from "./expression.ts";
import { formatResult } from "./format.ts";
import { EN_US, type NumberLocale } from "./locale.ts";
import type { Notice } from "./state.ts";

export interface ResultWords {
  text: string;
  tone: "result" | "error" | "note";
}

const NOTICES: Readonly<Record<Notice, string>> = {
  copied: "Copied",
  "refused-paste": "Nothing pasted: that isn't a number or a sum",
};

export function resultWords(shown: Outcome | { kind: "notice"; notice: Notice }, locale: NumberLocale = EN_US): ResultWords {
  switch (shown.kind) {
    case "notice":
      return { text: NOTICES[shown.notice], tone: "note" };
    case "value":
      return { text: `= ${formatResult(shown.value, locale)}`, tone: "result" };
    case "none":
      return { text: "", tone: "result" };
    case "error":
      if (shown.reason === "divide-by-zero") return { text: "Can't divide by 0", tone: "error" };
      if (shown.reason === "too-large") return { text: "Too large to work out", tone: "error" };
      return { text: "", tone: "result" };
  }
}
