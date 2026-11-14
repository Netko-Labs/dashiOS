/**
 * The pieces of Settings › Your Dashi (persona.tsx): the capsule as it will look, with its mark and its
 * dots, saying the preview's line; the six swatches; and a one-line field that keeps what was typed on Return.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COLOURS, type Colour, type ColourId, type PersonaSource } from "../../../persona/index.ts";
import { Group, Note, useSurface } from "../../../shared/cards/index.ts";
import { FaceDots } from "../../../shared/face/index.ts";
import { markSvg, type PersonaDots, type PersonaMark, type PersonaMotion } from "../../../shared/pill/index.ts";
import { useColors } from "../../colors.ts";

/** The capsule's measures (dashi-0.9.0-design/round3/pill-v2): 31 points tall, a white disc at its left, a light line round the fill. */
export const CAPSULE = { height: 31, disc: 21, dot: 4, line: "#ffffff59" } as const;

/** Dashi's capsule at true size, in the chosen colour, with the chosen mark, saying `line`. The white line and the sizes are not the person's to change. */
export function CapsulePreview({
  colour,
  mark,
  dots,
  motion,
  name,
  line,
  still,
}: {
  colour: Colour;
  mark: PersonaMark;
  dots: PersonaDots;
  motion: PersonaMotion;
  name: string;
  line: string;
  /** Reduce Motion: the dots keep their shape and do not move. */
  still: boolean;
}) {
  return (
    <View
      testID="persona-capsule"
      accessibilityLabel={`Dashi's capsule, ${colour.name}: ${line}`}
      style={{
        flexShrink: 1,
        minWidth: 0,
        height: CAPSULE.height,
        borderRadius: CAPSULE.height / 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: mark === "dots" ? 13 : 5,
        paddingRight: 14,
        backgroundColor: colour.to,
        borderWidth: 1,
        borderColor: CAPSULE.line,
      }}
    >
      {mark !== "dots" && (
        <View
          testID={`persona-capsule-mark:${mark}`}
          style={{
            flexShrink: 0,
            width: CAPSULE.disc,
            height: CAPSULE.disc,
            borderRadius: CAPSULE.disc / 2,
            backgroundColor: "#ffffff",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg markup={markSvg(mark)} size={13} color={colour.deep} />
        </View>
      )}
      <FaceDots testID={`persona-capsule-dots:${dots}`} dots={dots} motion={motion} mood="rest" color="#ffffff" still={still} />
      <View style={{ flexShrink: 0, width: 1, height: 13, backgroundColor: colour.soft, opacity: 0.5 }} />
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: "#ffffff" }}>
          {name}
        </Text>
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: colour.soft }}>
          {line}
        </Text>
      </View>
    </View>
  );
}

const SWATCH = 26;

/** Six round swatches; the chosen one wears a ring in the text's colour. */
export function Swatches({ value, onChange }: { value: ColourId; onChange: (colour: Colour) => void }) {
  const colors = useColors();
  return (
    <View testID="persona-colours" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {COLOURS.map((colour) => {
        const chosen = colour.id === value;
        return (
          <View
            key={colour.id}
            testID={`persona-colour:${colour.id}`}
            focusable
            accessibilityRole="button"
            accessibilityLabel={colour.name}
            accessibilityState={{ selected: chosen }}
            onPress={() => onChange(colour)}
            style={{
              width: SWATCH + 8,
              height: SWATCH + 8,
              borderRadius: (SWATCH + 8) / 2,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: chosen ? colors.text : "#00000000",
            }}
          >
            <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, backgroundColor: colour.to }} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * One line of the person's own words. What is typed is kept on Return, never at each key, so the
 * file and the change log get one change; `check` says why a text is not kept (the name rule).
 */
export function LineField({
  testID,
  value,
  placeholder,
  max,
  width = 220,
  onKeep,
  onDraft,
}: {
  testID: string;
  value: string;
  placeholder: string;
  max: number;
  width?: number | "100%";
  /** Return was pressed with `text` in the field. */
  onKeep: (text: string) => void;
  /** What is in the field now, for the row's quiet line. */
  onDraft?: (text: string) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const [draft, setDraft] = useState(value);
  // The file changed under it (Undo, a character chosen): the field follows.
  useEffect(() => setDraft(value), [value]);
  return (
    <View style={{ width }}>
      <TextInput
        testID={testID}
        value={draft}
        placeholder={placeholder}
        onChangeText={(text) => {
          const next = [...text.replace(/[\n\r]/g, " ")].slice(0, max).join("");
          setDraft(next);
          onDraft?.(next);
        }}
        onSubmitEditing={(text) => onKeep([...text].slice(0, max).join(""))}
        style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
      />
    </View>
  );
}

/** What a person's own character tells the assistant, in full, and the files that are not characters. */
export function CharacterFilesNotes({ source }: { source: PersonaSource }) {
  const view = useSyncExternalStore(source.subscribe, source.view);
  const refused = source.files().refused;
  return (
    <>
      {view.character.own && view.missing === null && (
        <Group testID="persona-told">
          <Note testID="persona-told-text">{`This is what your agent will be told: ${view.character.prompt[source.language()]}`}</Note>
        </Group>
      )}
      {refused.length > 0 && (
        <Group testID="persona-refused">
          {refused.slice(0, 4).map((each) => (
            <Note key={each.file} testID={`persona-refused:${each.file}`}>{`${each.file}: This file is not a character: ${each.why}.`}</Note>
          ))}
        </Group>
      )}
    </>
  );
}
