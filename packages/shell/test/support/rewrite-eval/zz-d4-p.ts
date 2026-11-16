import { Lexicon, systemWords } from "../../../src/dictation/index.ts";
import { compose } from "../../../src/dictation/lib/compose.ts";
import { withPauses } from "../../../src/dictation/lib/gate.ts";
import { PROFILES, pickProfile } from "../../../src/dictation/lib/profiles.ts";
import { reasonsFor, withModel } from "../../../src/dictation/lib/rewrite.ts";
import { rewriteMessages } from "../../../src/rewrite/prompt.ts";
import { checkAnswer } from "../../../src/rewrite/checks.ts";
const composing = { place: pickProfile(PROFILES, { window: 1, pid: 1, appId: "dev.dashi.editor" }, null), lexicon: new Lexicon({ memory: true }).getSnapshot(), words: systemWords(), tidy: true, agent: false };
for (const heard of (await Bun.stdin.text()).split("\n").filter(Boolean)) {
  const made = compose(heard, composing);
  const reasons = reasonsFor(made, composing);
  let landed = made.text;
  if (reasons.length) {
    const sent = withPauses(made.text);
    const r = await fetch("http://localhost/v1/chat/completions", { unix: "/tmp/claude-1000/-home-pejedev/2e4ca6f9-c0ca-43a4-8866-36b5c852bfbc/scratchpad/llama.sock", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: rewriteMessages({ transcript: sent, tone: "", vocabulary: [], before: "" }), temperature: 0, max_tokens: 400 }) });
    const a = (await r.json()).choices[0].message.content;
    const c = checkAnswer(sent, a);
    landed = c.ok ? (c.unchanged ? made.text : withModel(made, c.text, composing).text) : made.text + "  [refused " + c.check + "]";
  }
  console.log([heard, reasons.join(",") || "-", landed].join("  |  "));
}
