/**
 * The pieces of Settings › Your Dashi (persona.tsx): the capsule as it will look, with its mark and its
 * dots, saying the preview's line; the six swatches; and a one-line field that keeps what was typed on Return.
 */

import { CAPSULE as CAPSULE_INKS, OPACITY, PictureChoice, SPACE, TextField, TYPE, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COLOURS, type Colour, type ColourId, type PersonaSource } from "../../../persona/index.ts";
import { Caption } from "../../../shared/cards/index.ts";
import { FaceDots } from "../../../shared/face/index.ts";
import { markSvg, type PersonaDots, type PersonaMark, type PersonaMotion } from "../../../shared/pill/index.ts";
import { Failure } from "./parts.tsx";

/** The capsule's measures (dashi-0.9.0-design/round3/pill-v2): 31 points tall, a white disc at its left, a light line round the fill. */
export const CAPSULE = { height: 31, disc: 21, dot: 4, mark: 13, rule: 13, line: CAPSULE_INKS.rimOnFill } as const;
/** Its insets: before the dots alone, before the disc, after the words. */
const CAPSULE_INSET = { dots: 13, disc: 5, end: 14 } as const;

/** Dashi's capsule at true size, in the chosen colour, with the chosen mark, saying `line`. The white line and the sizes are not the person's to change. */
export function CapsulePreview({
  colour,
  mark,
  dots,
  motion,
  name,
  line,
  still,
  said = 0,
}: {
  colour: Colour;
  mark: PersonaMark;
  dots: PersonaDots;
  motion: PersonaMotion;
  name: string;
  line: string;
  /** Reduce Motion: the dots keep their shape and do not move. */
  still: boolean;
  /** Counts presses of "Hear it": each one says the line again. */
  said?: number;
}) {
  const word = useSaying(line, `${motion}:${dots}:${said}`, still);
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
        gap: SPACE.m,
        paddingLeft: mark === "dots" ? CAPSULE_INSET.dots : CAPSULE_INSET.disc,
        paddingRight: CAPSULE_INSET.end,
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
            backgroundColor: CAPSULE_INKS.white,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg markup={markSvg(mark)} size={CAPSULE.mark} color={colour.deep} />
        </View>
      )}
      <FaceDots
        testID={`persona-capsule-dots:${dots}${word === null ? "" : ":saying"}`}
        dots={dots}
        motion={motion}
        mood={word === null ? "rest" : "speak"}
        color={CAPSULE_INKS.white}
        still={still}
        {...(word === null ? {} : { word })}
      />
      <View style={{ flexShrink: 0, width: 1, height: CAPSULE.rule, backgroundColor: colour.soft, opacity: OPACITY.half }} />
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: CAPSULE_INKS.white }}>
          {name}
        </Text>
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: colour.soft }}>
          {line}
        </Text>
      </View>
    </View>
  );
}

/** How long the preview takes over each word, and the most words it moves to. */
export const SAYING = { perWord: 230, words: 14 } as const;

/**
 * The preview says its line when a character is chosen, and again at "Hear it": the dots jump on
 * each word, the character's way, and then rest. The word it is on, or null while it rests. Its one
 * timer runs only for those few seconds; never at first sight, and never with Reduce Motion.
 */
function useSaying(line: string, what: string, still: boolean): number | null {
  const [word, setWord] = useState<number | null>(null);
  const seen = useRef(what);
  const words = Math.min(SAYING.words, line.split(/\s+/).length);
  useEffect(() => {
    if (seen.current === what || still) {
      seen.current = what;
      return;
    }
    seen.current = what;
    let at = 0;
    setWord(0);
    const timer = setInterval(() => {
      at += 1;
      if (at >= words) {
        clearInterval(timer);
        setWord(null);
      } else setWord(at);
    }, SAYING.perWord);
    return () => {
      clearInterval(timer);
      setWord(null);
    };
  }, [what, still, words]);
  return word;
}

/** A swatch: 26 round, in a listbox 8 apart. */
const SWATCH = { size: 26, gap: SPACE.m } as const;

/** Six round swatches; the chosen one wears the ink ring (the choices are colours: PictureChoice's ink). */
export function Swatches({ value, onChange }: { value: ColourId; onChange: (colour: Colour) => void }) {
  return (
    <View
      testID="persona-colours"
      focusGroup
      accessibilityRole="listbox"
      style={{ flexDirection: "row", alignItems: "center", gap: SWATCH.gap, flexWrap: "wrap" }}
    >
      {COLOURS.map((colour) => (
        <PictureChoice
          key={colour.id}
          testID={`persona-colour:${colour.id}`}
          label={colour.name}
          chosen={colour.id === value}
          ring="ink"
          radius={SWATCH.size / 2}
          onPress={() => onChange(colour)}
        >
          <View style={{ width: SWATCH.size, height: SWATCH.size, borderRadius: SWATCH.size / 2, backgroundColor: colour.to }} />
        </PictureChoice>
      ))}
    </View>
  );
}

/** The field's width beside its row's words. */
const PERSONA_TEXT = { width: 220 } as const;

/**
 * One line of the person's own words, in the kit's field (UI-9). What is typed is kept on Return, never at each key, so the
 * file and the change log get one change; `check` says why a text is not kept (the name rule).
 */
export function PersonaText({
  testID,
  label,
  value,
  placeholder,
  max,
  width = PERSONA_TEXT.width,
  onKeep,
  onDraft,
}: {
  testID: string;
  /** What a screen reader calls it ("Dashi's name"). */
  label: string;
  value: string;
  placeholder: string;
  max: number;
  /** Pixels; the row's width with "fill". */
  width?: number | "fill";
  /** Return was pressed with `text` in the field. */
  onKeep: (text: string) => void;
  /** What is in the field now, for the row's quiet line. */
  onDraft?: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // The file changed under it (Undo, a character chosen): the field follows.
  useEffect(() => setDraft(value), [value]);
  return (
    <TextField
      look="panel"
      testID={testID}
      label={label}
      value={draft}
      placeholder={placeholder}
      {...(width === "fill" ? {} : { width })}
      onChangeText={(text) => {
        const next = [...text.replace(/[\n\r]/g, " ")].slice(0, max).join("");
        setDraft(next);
        onDraft?.(next);
      }}
      onSubmit={(text) => onKeep([...text].slice(0, max).join(""))}
    />
  );
}

/** What a person's own character tells the assistant, in full, and the files that are not characters. */
export function CharacterFilesNotes({ source }: { source: PersonaSource }) {
  const view = useSyncExternalStore(source.subscribe, source.view);
  const refused = source.files().refused;
  return (
    <>
      {view.character.own && view.missing === null && (
        <View testID="persona-told">
          <Caption>{`This is what your agent will be told: ${view.character.prompt[source.language()]}`}</Caption>
        </View>
      )}
      {refused.slice(0, 4).map((each) => (
        <Failure key={each.file} testID={`persona-refused:${each.file}`}>{`${each.file}: This file is not a character: ${each.why}.`}</Failure>
      ))}
    </>
  );
}
