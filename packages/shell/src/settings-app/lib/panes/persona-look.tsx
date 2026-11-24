/**
 * Your Dashi's look (persona.tsx): six swatches, the eight marks for its disc, and the six shapes
 * of its five dots, each button drawing what it sets. Ids only are written: no colour, glyph or
 * shape of the person's own (docs/decisions.md D59, D75).
 */

import { PictureChoice, RADIUS, SPACE } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { PersonaSource } from "../../../persona/index.ts";
import { Group } from "../../../shared/cards/index.ts";
import { FaceDots } from "../../../shared/face/index.ts";
import { DOT_SHAPES, GLYPH_NAMES, markSvg, PERSONA_GLYPHS } from "../../../shared/pill/index.ts";
import { useColors } from "../../colors.ts";
import type { SettingsStore } from "../../store.ts";
import type { PersonOnly } from "../person-only.ts";
import { ONLY_YOU } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { Swatches } from "./persona-parts.tsx";

/** A mark's tile and a dots' tile: their pictures, ringed in ink when chosen (the choices are Dashi's own colours: CO-9's ink ring). */
const TILE = { height: 28, mark: 28, dots: 50, glyph: 17 } as const;

/** One picture of a row of pictures to pick; the chosen one wears the ink ring (PictureChoice). */
function Tile({
  testID,
  label,
  chosen,
  width = TILE.mark,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  chosen: boolean;
  width?: number;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <PictureChoice testID={testID} label={label} chosen={chosen} ring="ink" radius={RADIUS.control} onPress={onPress}>
      <View style={{ width, height: TILE.height, borderRadius: RADIUS.control, alignItems: "center", justifyContent: "center" }}>{children}</View>
    </PictureChoice>
  );
}

const quiet = (guard: PersonOnly, row: string): { detail?: string } => (guard.refused === row ? { detail: ONLY_YOU } : {});

export function Look({ settings, persona, guard }: { settings: SettingsStore; persona: { source: PersonaSource }; guard: PersonOnly }) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  const colors = useColors();
  return (
    <Group testID="persona-look">
      <Setting id="persona/colour" testID="persona-colour" {...quiet(guard, "persona/colour")}>
        <Swatches value={view.colour.id} onChange={(colour) => guard.mine("persona/colour", () => settings.patch("persona", { colour: colour.to }))} />
      </Setting>
      <Setting id="persona/mark" testID="persona-mark" {...quiet(guard, "persona/mark")} stack>
        <View
          testID="persona-marks"
          focusGroup
          accessibilityRole="listbox"
          style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexWrap: "wrap" }}
        >
          {PERSONA_GLYPHS.map((glyph) => (
            <Tile
              key={glyph}
              testID={`persona-mark:${glyph}`}
              label={GLYPH_NAMES[glyph]}
              chosen={view.mark === glyph}
              onPress={() => guard.mine("persona/mark", () => settings.patch("persona", { mark: glyph }))}
            >
              <Svg markup={markSvg(glyph)} size={TILE.glyph} color={view.mark === glyph ? view.colour.to : colors.text} />
            </Tile>
          ))}
        </View>
      </Setting>
      <Setting id="persona/dots" testID="persona-dots" {...quiet(guard, "persona/dots")} stack>
        <View
          testID="persona-dot-shapes"
          focusGroup
          accessibilityRole="listbox"
          style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexWrap: "wrap" }}
        >
          {DOT_SHAPES.map((shape) => (
            <Tile
              key={shape.id}
              testID={`persona-dots:${shape.id}`}
              label={shape.name}
              width={TILE.dots}
              chosen={view.dots === shape.id}
              onPress={() => guard.mine("persona/dots", () => settings.patch("persona", { dots: shape.id }))}
            >
              <FaceDots dots={shape.id} motion="still" mood="rest" color={view.dots === shape.id ? view.colour.to : colors.text} />
            </Tile>
          ))}
        </View>
      </Setting>
    </Group>
  );
}
