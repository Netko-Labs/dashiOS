import { Lexicon, systemWords } from "../../../src/dictation/index.ts";
import { compose } from "../../../src/dictation/lib/compose.ts";
import { withPauses } from "../../../src/dictation/lib/gate.ts";
import { PROFILES, pickProfile } from "../../../src/dictation/lib/profiles.ts";
import { reasonsFor } from "../../../src/dictation/lib/rewrite.ts";
import { FIXTURES, loadPairs } from "./score.ts";
const composing = { place: pickProfile(PROFILES, { window: 1, pid: 1, appId: "dev.dashi.editor" }, null), lexicon: new Lexicon({ memory: true }).getSnapshot(), words: systemWords(), tidy: true, agent: false };
for (const pair of loadPairs(FIXTURES)) {
  const made = compose(pair.heard, composing);
  const sent = withPauses(made.text);
  if (sent !== made.text) console.log([pair.id, pair.tags.join(","), reasonsFor(made, composing).join(","), made.text, sent].join("\t"));
}
