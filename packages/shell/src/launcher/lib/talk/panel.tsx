/**
 * The launcher's panel in the conversation (decisions.md D261): the thread
 * (view.tsx) above, then the field at the bottom, the one chrome row, with
 * the persona's spark in place of the magnifier, the keys that do something
 * now, and a round button: Stop while a turn works, Send otherwise.
 */

import { GlyphButton, SPACE, SQUARE, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { SPARKLE } from "../../../settings-app/glyphs.ts";
import type { LauncherProps } from "../../props.ts";
import type { LauncherKeys } from "../commands.ts";
import { FieldRow } from "../field.tsx";
import type { LauncherState } from "../state.ts";
import { talkHints, talkPlaceholder, tries } from "./talk-mode.ts";
import { TalkView } from "./view.tsx";

const UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;

/** Stop while a turn works (ink, it goes ahead); Send when there are words (the agents' shiso); the kit's large GlyphButton. */
function RoundAction({ working, ready, onStop, onSend }: { working: boolean; ready: boolean; onStop: () => void; onSend: () => void }) {
  if (working) return <GlyphButton testID="talk:stop" glyph={SQUARE} label="Stop" size="large" tone="primary" onPress={onStop} />;
  return <GlyphButton testID="talk:send" glyph={UP} label="Send" size="large" tone="agent" disabled={!ready} onPress={onSend} />;
}

export function TalkPanel({
  props,
  s,
  keys,
  revision,
  colour,
}: {
  props: LauncherProps;
  s: LauncherState;
  keys: LauncherKeys;
  revision: number;
  colour: string;
}) {
  const colors = useColors();
  const dashi = props.dashi;
  const view = s.talk;
  const name = dashi?.name() ?? "Dashi";
  const shown = tries(dashi?.recent() ?? []);
  const working = view.working && !view.background && view.waiting === null;
  return (
    <>
      <TalkView
        view={view}
        name={name}
        colour={colour}
        model={dashi?.model() ?? null}
        tries={shown}
        selected={Math.min(s.tryAt, shown.length - 1)}
        onTry={(text) => dashi?.type(text)}
        onHover={s.setTryAt}
        onAnswer={(yes) => dashi?.reply({ text: yes ? "yes" : "no", by: "typing" })}
        onGo={(go) => {
          if (go === "launcher") props.agents?.signIn();
          else props.agents?.setUp();
          props.onClose();
        }}
        onLink={(url) => dashi?.openLink(url)}
      />
      <View style={{ borderTopWidth: view.turns.length > 0 || shown.length > 0 ? 1 : 0, borderColor: colors.separator, paddingRight: SPACE.m }}>
        <FieldRow
          value={s.filter}
          revision={revision}
          placeholder={talkPlaceholder(view, name)}
          glyph={{ markup: SPARKLE, color: colour }}
          hints={talkHints(view, s.filter)}
          notice={s.notice}
          trailing={<RoundAction working={working} ready={s.filter.trim() !== ""} onStop={() => dashi?.stop()} onSend={() => keys.submit()} />}
          onChangeText={keys.onChangeText}
          onSubmit={() => keys.submit()}
          onKey={keys.onKey}
        />
      </View>
    </>
  );
}
