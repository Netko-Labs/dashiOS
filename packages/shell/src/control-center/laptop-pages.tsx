/**
 * The laptop tiles' pages, grown out of their tiles (page-parts.tsx): the
 * power mode (Automatic and the three modes, with what Automatic chose and
 * why), the keyboard light's levels, and Graphics (the three modes and
 * Automatic, what the card is doing, and the apps allowed on it in Smart
 * mode; a lost card says so and offers Restart…). The choice in effect is
 * the green row.
 */

import { cardState, useGraphics } from "../graphics/controller.ts";
import { LOST_NOTICE } from "../graphics/lost-card.ts";
import { GRAPHICS_LABEL, GRAPHICS_MODES } from "../graphics/policy.ts";
import { keyboardLightGlyph, modeGlyph } from "../laptop/glyphs.ts";
import type { Laptop } from "../laptop/start.ts";
import { keyboardLight, lightLabel, useLaptop } from "../laptop/store.ts";
import { useModes } from "../power/modes/store.ts";
import { MODE_LABEL, MODE_SHORT } from "../power/modes/types.ts";
import type { LaptopPage } from "./catalog.ts";
import { PageBody, PageHeader, PageNote, PageRow, PageSection } from "./page-parts.tsx";

function ModePage({ laptop, onBack }: { laptop: Laptop; onBack: () => void }) {
  const modes = useModes(laptop.modes);
  const now = modes.effective?.mode;
  const automatic = modes.choice === "automatic";
  return (
    <>
      <PageHeader
        testID="laptop-mode-header"
        title="Power"
        detail={automatic ? (now ? `Auto · ${MODE_SHORT[now]}` : "Automatic") : now ? MODE_LABEL[now] : null}
        on={automatic}
        onBack={onBack}
      />
      <PageBody>
        <PageRow
          testID="laptop-mode-automatic"
          label="Automatic"
          detail={automatic && now ? `${MODE_LABEL[now]} now` : null}
          checked={automatic}
          onPress={() => laptop.modes.choose("automatic")}
        />
        {modes.available.map((mode) => (
          <PageRow
            key={mode}
            testID={`laptop-mode-${mode}`}
            label={MODE_LABEL[mode]}
            glyph={modeGlyph(mode)}
            checked={modes.choice === mode}
            onPress={() => laptop.modes.choose(mode)}
          />
        ))}
        {modes.effective && <PageNote>{`${modes.effective.why}.`}</PageNote>}
      </PageBody>
    </>
  );
}

function LightPage({ laptop, onBack, onToggle }: { laptop: Laptop; onBack: () => void; onToggle: () => void }) {
  const light = keyboardLight(useLaptop(laptop.store));
  const on = (light?.level ?? 0) > 0;
  return (
    <>
      <PageHeader
        testID="laptop-light-header"
        title="Keyboard"
        detail={light ? lightLabel(light.level, light.max) : null}
        on={on}
        onBack={onBack}
        toggle={{ on, onChange: onToggle }}
      />
      <PageBody>
        {light &&
          Array.from({ length: light.max + 1 }, (_, level) => (
            <PageRow
              // The levels never reorder.
              key={level}
              testID={`laptop-light-${level}`}
              label={lightLabel(level, light.max)}
              glyph={keyboardLightGlyph(level > 0)}
              checked={light.level === level}
              onPress={() => laptop.setLight(level)}
            />
          ))}
      </PageBody>
    </>
  );
}

function GraphicsPage({ laptop, onBack, onRestart }: { laptop: Laptop; onBack: () => void; onRestart: () => void }) {
  const graphics = useGraphics(laptop.graphics);
  const state = cardState(graphics);
  if (graphics.lost) {
    return (
      <>
        <PageHeader testID="laptop-graphics-header" title="Graphics" detail="Not responding" on={false} onBack={onBack} />
        <PageBody>
          <PageNote>{LOST_NOTICE.summary}</PageNote>
          <PageNote>{LOST_NOTICE.body}</PageNote>
          <PageRow testID="laptop-graphics-restart" label="Restart…" onPress={onRestart} />
        </PageBody>
      </>
    );
  }
  const mode = graphics.mode;
  return (
    <>
      <PageHeader testID="laptop-graphics-header" title="Graphics" detail={state || null} on={mode !== null && mode !== "integrated"} onBack={onBack} />
      <PageBody>
        <PageRow
          testID="laptop-graphics-automatic"
          label="Automatic"
          detail={graphics.choice === "automatic" && graphics.decision?.wanted ? GRAPHICS_LABEL[graphics.decision.wanted] : null}
          checked={graphics.choice === "automatic"}
          onPress={() => laptop.graphics.choose("automatic")}
        />
        {GRAPHICS_MODES.map((each) => (
          <PageRow
            key={each}
            testID={`laptop-graphics-${each}`}
            label={GRAPHICS_LABEL[each]}
            detail={mode === each ? "Now" : null}
            checked={graphics.choice === each}
            onPress={() => laptop.graphics.choose(each)}
          />
        ))}
        {graphics.decision && <PageNote>{`${graphics.decision.why}.`}</PageNote>}
        {(graphics.choice === "smart" || mode === "smart") && <PageNote>Apps you allow use the graphics card; the rest use the built-in one.</PageNote>}
        {graphics.allowed.length > 0 && <PageSection>Allowed</PageSection>}
        {graphics.allowed.map((app) => (
          <PageRow
            key={app.id}
            testID={`laptop-graphics-app-${app.id}`}
            label={app.name}
            detail={graphics.holders.some((holder) => holder.name === app.name) ? "Running" : null}
          />
        ))}
      </PageBody>
    </>
  );
}

export function LaptopPageView({
  page,
  laptop,
  onBack,
  onRestart,
  onLightToggle,
}: {
  page: LaptopPage;
  laptop: Laptop;
  onBack: () => void;
  onRestart: () => void;
  onLightToggle: () => void;
}) {
  switch (page) {
    case "laptop-mode":
      return <ModePage laptop={laptop} onBack={onBack} />;
    case "laptop-light":
      return <LightPage laptop={laptop} onBack={onBack} onToggle={onLightToggle} />;
    case "graphics":
      return <GraphicsPage laptop={laptop} onBack={onBack} onRestart={onRestart} />;
  }
}
