/**
 * The screens: the `outputs` reply read once, by one shape, into the whole
 * record (docs/compositor-ipc.md, "Screens"). What each part of the shell
 * needs (the placed screens, the built-in ones, the usable areas) is a plain
 * function of `Output[]`, never a parser of its own (H7, Hickey F1).
 */

import { bool, type Infer, lenientList, map, maybe, nullable, num, obj, optional, str, withDefault } from "@dashi/shape";
import { type Frame, FrameShape } from "./wire.ts";

const LOOSE = { strict: false } as const;

const ModeShape = obj({ width: num(), height: num(), refreshMhz: num() }, LOOSE);

const OfferedModeShape = obj(
  { width: num(), height: num(), refreshMhz: num(), preferred: withDefault(bool(), false), current: withDefault(bool(), false) },
  LOOSE,
);

const VRR_MODES = ["off", "on", "fullscreen"] as const;
/** A mode this shell doesn't know reads as off, as Displays shows it. */
const vrrMode = map(optional(str()), (mode) => VRR_MODES.find((known) => known === mode) ?? "off");

/** A frame with a positive size, else null. */
const area = map(optional(nullable(FrameShape)), (frame) => (frame && frame.width > 0 && frame.height > 0 ? frame : null));

const OutputFields = obj(
  {
    name: str({ min: 1, max: 64 }),
    make: withDefault(str(), ""),
    model: withDefault(str(), ""),
    serial: withDefault(str(), ""),
    enabled: withDefault(bool(), true),
    lit: optional(bool()),
    mirrorOf: map(optional(nullable(str())), (source) => source ?? null),
    primary: withDefault(bool(), false),
    physicalMm: withDefault(obj({ width: num(), height: num() }, LOOSE), { width: 0, height: 0 }),
    scale: map(optional(num()), (scale) => (scale !== undefined && scale > 0 ? scale : 1)),
    transform: withDefault(obj({ rotation: withDefault(num(), 0), flipped: withDefault(bool(), false) }, LOOSE), { rotation: 0, flipped: false }),
    mode: map(optional(nullable(ModeShape)), (mode) => mode ?? null),
    modes: withDefault(lenientList(OfferedModeShape), []),
    frame: area,
    usable: area,
    vrr: withDefault(obj({ supported: withDefault(bool(), false), active: withDefault(bool(), false), mode: vrrMode }, LOOSE), {
      supported: false,
      active: false,
      mode: "off",
    }),
  },
  LOOSE,
);

/** One screen, with what an older compositor leaves out at its default. */
export const OutputShape = map(OutputFields, (output) => ({ ...output, lit: output.lit ?? output.enabled }));
export type Output = Infer<typeof OutputShape>;

/** The `outputs` reply: every screen the compositor knows; one it can't read is left out. */
export const OutputsShape = map(obj({ outputs: lenientList(OutputShape) }, LOOSE), ({ outputs }) => outputs);

/** The screens in an `outputs` reply ([] when it is not one). */
export const outputsOf = (answer: unknown): Output[] => maybe(OutputsShape, answer) ?? [];

/** A screen with a desktop of its own: on, not mirroring another, placed. */
export const placed = (output: Output): output is Output & { frame: Frame; usable: Frame } =>
  output.enabled && output.mirrorOf === null && output.frame !== null && output.usable !== null;

/** Its size in pixels and millimetres as a person sees it (a screen on its side is as tall as it is wide). */
export function seenSize(output: Output): { width: number; height: number; widthMm: number; heightMm: number } | null {
  if (!output.mode) return null;
  const sideways = output.transform.rotation === 90 || output.transform.rotation === 270;
  const { width, height } = output.mode;
  const mm = output.physicalMm;
  return sideways ? { width: height, height: width, widthMm: mm.height, heightMm: mm.width } : { width, height, widthMm: mm.width, heightMm: mm.height };
}
