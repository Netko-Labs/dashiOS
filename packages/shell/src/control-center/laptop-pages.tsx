/**
 * The pages behind the laptop row's long press: the power mode (Automatic
 * and the three modes, with what Automatic chose and why), the keyboard
 * light's levels, and Graphics (the three modes and Automatic, what the card
 * is doing, and the apps allowed on it in Smart mode; a lost card says so
 * and offers Restart…).
 */

import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { cardState, useGraphics } from "../graphics/controller.ts";
import { LOST_NOTICE } from "../graphics/lost-card.ts";
import { GRAPHICS_LABEL, GRAPHICS_MODES } from "../graphics/policy.ts";
import type { Laptop } from "../laptop/start.ts";
import { keyboardLight, lightLabel, useLaptop } from "../laptop/store.ts";
import { useModes } from "../power/modes/store.ts";
import { MODE_LABEL } from "../power/modes/types.ts";
import { CHEVRON_LEFT } from "./glyphs.ts";
import type { LaptopPage } from "./laptop-row.tsx";

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 28 }}>
      <View
        testID="laptop-back"
        onPress={onBack}
        style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={CHEVRON_LEFT} size={14} color={colors.text} />
      </View>
      <Text style={{ fontSize: 14, fontWeight: "bold", color: colors.text }}>{title}</Text>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={{ flexDirection: "column", padding: 4, borderRadius: 12, backgroundColor: colors.tile }}>{children}</View>;
}

function Choice({ testID, label, detail, checked, onPress }: { testID: string; label: string; detail?: string; checked: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 30,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 8,
        hoverBackgroundColor: colors.button,
      }}
    >
      <View style={{ width: 14 }}>{checked && <Svg markup={CHECK} size={12} color={colors.text} />}</View>
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      {detail && (
        <View style={{ marginLeft: "auto" }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{detail}</Text>
        </View>
      )}
    </View>
  );
}

function Line({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

function ModePage({ laptop, onBack }: { laptop: Laptop; onBack: () => void }) {
  const modes = useModes(laptop.modes);
  const now = modes.effective?.mode;
  return (
    <>
      <Header title="Power Mode" onBack={onBack} />
      <Card>
        <Choice
          testID="laptop-mode-automatic"
          label="Automatic"
          {...(modes.choice === "automatic" && now ? { detail: `${MODE_LABEL[now]} now` } : {})}
          checked={modes.choice === "automatic"}
          onPress={() => laptop.modes.choose("automatic")}
        />
        {modes.available.map((mode) => (
          <Choice
            key={mode}
            testID={`laptop-mode-${mode}`}
            label={MODE_LABEL[mode]}
            checked={modes.choice === mode}
            onPress={() => laptop.modes.choose(mode)}
          />
        ))}
        {modes.effective && <Line>{`${modes.effective.why}.`}</Line>}
      </Card>
    </>
  );
}

function LightPage({ laptop, onBack }: { laptop: Laptop; onBack: () => void }) {
  const light = keyboardLight(useLaptop(laptop.store));
  return (
    <>
      <Header title="Keyboard Light" onBack={onBack} />
      <Card>
        {light &&
          Array.from({ length: light.max + 1 }, (_, level) => (
            <Choice
              // The levels never reorder.
              key={level}
              testID={`laptop-light-${level}`}
              label={lightLabel(level, light.max)}
              checked={light.level === level}
              onPress={() => laptop.setLight(level)}
            />
          ))}
      </Card>
    </>
  );
}

function GraphicsPage({ laptop, onBack, onRestart }: { laptop: Laptop; onBack: () => void; onRestart: () => void }) {
  const graphics = useGraphics(laptop.graphics);
  const state = cardState(graphics);
  if (graphics.lost) {
    return (
      <>
        <Header title="Graphics" onBack={onBack} />
        <Card>
          <Line>{LOST_NOTICE.summary}</Line>
          <Line>{LOST_NOTICE.body}</Line>
          <Choice testID="laptop-graphics-restart" label="Restart…" checked={false} onPress={onRestart} />
        </Card>
      </>
    );
  }
  const mode = graphics.mode;
  return (
    <>
      <Header title={state ? `Graphics · ${state}` : "Graphics"} onBack={onBack} />
      <Card>
        <Choice
          testID="laptop-graphics-automatic"
          label="Automatic"
          {...(graphics.choice === "automatic" && graphics.decision?.wanted ? { detail: GRAPHICS_LABEL[graphics.decision.wanted] } : {})}
          checked={graphics.choice === "automatic"}
          onPress={() => laptop.graphics.choose("automatic")}
        />
        {GRAPHICS_MODES.map((each) => (
          <Choice
            key={each}
            testID={`laptop-graphics-${each}`}
            label={GRAPHICS_LABEL[each]}
            {...(mode === each ? { detail: "Now" } : {})}
            checked={graphics.choice === each}
            onPress={() => laptop.graphics.choose(each)}
          />
        ))}
        {graphics.decision && <Line>{`${graphics.decision.why}.`}</Line>}
        {(graphics.choice === "smart" || mode === "smart") && <Line>Apps you allow use the graphics card; the rest use the built-in one.</Line>}
      </Card>
      {graphics.allowed.length > 0 && (
        <Card>
          <Line>Allowed</Line>
          {graphics.allowed.map((app) => (
            <Choice
              key={app.id}
              testID={`laptop-graphics-app-${app.id}`}
              label={app.name}
              {...(graphics.holders.some((holder) => holder.name === app.name) ? { detail: "Running" } : {})}
              checked={false}
              onPress={() => {}}
            />
          ))}
        </Card>
      )}
    </>
  );
}

export function LaptopPageView({ page, laptop, onBack, onRestart }: { page: LaptopPage; laptop: Laptop; onBack: () => void; onRestart: () => void }) {
  switch (page) {
    case "laptop-mode":
      return <ModePage laptop={laptop} onBack={onBack} />;
    case "laptop-light":
      return <LightPage laptop={laptop} onBack={onBack} />;
    case "graphics":
      return <GraphicsPage laptop={laptop} onBack={onBack} onRestart={onRestart} />;
  }
}
