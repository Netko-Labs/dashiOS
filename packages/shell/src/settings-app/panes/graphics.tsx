/**
 * Graphics (docs/0.4.0.html, Graphics E): the machine's two GPUs with what
 * each does and whether the card sleeps, the mode (Automatic, Integrated,
 * Smart, Hybrid, through cardwire), and the MUX ("Graphics card only",
 * dashi-hardware's `gpu-mux`), which applies at the next restart. A lost card
 * says so here too. The pane is listed only on a machine with a graphics card.
 */

import { useMemo } from "react";
import { chooseGpu, readCards } from "../../gpu.ts";
import { cardState, useGraphics } from "../../graphics/controller.ts";
import { LOST_NOTICE } from "../../graphics/lost-card.ts";
import { GRAPHICS_LABEL, GRAPHICS_MODES } from "../../graphics/policy.ts";
import type { Laptop } from "../../laptop/start.ts";
import { useLaptop } from "../../laptop/store.ts";
import type { GraphicsChoice } from "../../power/modes/settings.ts";
import { GPU } from "../knob-glyphs.ts";
import { Button, Caption, Choices, Group, Item, Note, Page, Setting, Switch } from "../ui.tsx";
import { Value } from "./parts.tsx";

const DRIVER_NAMES: Readonly<Record<string, string>> = { amdgpu: "AMD Radeon", i915: "Intel", xe: "Intel", nvidia: "NVIDIA", nouveau: "NVIDIA" };

function OneGpu() {
  return (
    <Page title="Graphics">
      <Group>
        <Note testID="graphics-none">This computer has one graphics processor.</Note>
      </Group>
    </Page>
  );
}

export function GraphicsPane({ laptop }: { laptop: Laptop | null }) {
  return laptop ? <GraphicsPaneBody laptop={laptop} /> : <OneGpu />;
}

function GraphicsPaneBody({ laptop }: { laptop: Laptop }) {
  const graphics = useGraphics(laptop.graphics);
  const machine = useLaptop(laptop.store);
  const cards = useMemo(() => {
    const all = readCards().filter((card) => card.driver !== null && card.driver !== "simpledrm");
    return { all, display: chooseGpu(all)?.card ?? null };
  }, []);
  // 0 is the graphics card only, 1 both (hybrid): docs/hardware.md.
  const mux = machine.knobs.get("gpu-mux");
  if (!graphics.hasCard) return <OneGpu />;
  const state = cardState(graphics);
  // cardwire knows the cards' marketing names; sysfs only their drivers.
  const nameOf = (builtIn: boolean, brand: string) =>
    graphics.cards.find((card) => card.isDefault === builtIn)?.name ?? (builtIn ? `${brand} (built in)` : `${brand} graphics card`);
  return (
    <Page title="Graphics">
      {graphics.lost && (
        <Group testID="graphics-lost">
          <Item label={LOST_NOTICE.summary} detail={LOST_NOTICE.body}>
            <Button testID="graphics-restart" label="Restart…" onPress={() => laptop.run({ kind: "restart" })} />
          </Item>
        </Group>
      )}
      <Group testID="graphics-cards">
        {cards.all.map((card) => {
          const builtIn = card === cards.display;
          const brand = DRIVER_NAMES[card.driver ?? ""] ?? card.driver ?? card.name;
          return (
            <Item
              key={card.name}
              glyph={GPU}
              label={nameOf(builtIn, brand)}
              detail={builtIn ? "Built in · drives this screen" : `Graphics card${state ? ` · ${state.toLowerCase()}` : ""}`}
            >
              <Value>{builtIn ? "Active" : graphics.lost ? "Not responding" : graphics.power === "suspended" ? "Asleep" : "Awake"}</Value>
            </Item>
          );
        })}
      </Group>
      {graphics.switchable && !graphics.lost && (
        <Group testID="graphics-mode">
          <Setting id="graphics/mode" {...(graphics.decision ? { detail: `${graphics.decision.why}.` } : {})}>
            <Choices<GraphicsChoice>
              testID="graphics-mode-choice"
              value={graphics.choice}
              options={[{ value: "automatic", label: "Automatic" }, ...GRAPHICS_MODES.map((mode) => ({ value: mode, label: GRAPHICS_LABEL[mode] }))]}
              onChange={(choice) => laptop.graphics.choose(choice)}
            />
          </Setting>
        </Group>
      )}
      {mux && (
        <>
          <Group testID="graphics-mux">
            <Setting id="graphics/card-only">
              <Switch testID="graphics-mux-switch" on={mux.value === 0} onChange={(on) => void laptop.store.set("gpu-mux", on ? 0 : 1)} />
            </Setting>
            <Setting id="graphics/restart">
              <Button testID="graphics-mux-restart" label="Restart…" onPress={() => laptop.run({ kind: "restart" })} />
            </Setting>
          </Group>
          <Caption>Changing it asks for your password.</Caption>
        </>
      )}
    </Page>
  );
}
