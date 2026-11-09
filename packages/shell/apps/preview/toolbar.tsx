/**
 * Preview's toolbar buttons: moving, zooming, rotating, and the rest; what
 * doesn't fit is in "…" (fold.ts). Every glyph names itself in a tooltip and
 * to a screen reader (UI-3), with the menu bar's words.
 */

import { type MenuItem, ToolbarButton, useColors, useTooltip } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { Fragment } from "react";
import { dividerBefore, TOOLS, type ToolId } from "./fold.ts";
import * as glyphs from "./glyphs.ts";

export interface ToolbarProps {
  /** Previous and next: the folder's images, or a PDF's pages. */
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** "3 / 12" beside the arrows, for a PDF. */
  position: string | null;
  zoomLabel: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onActual: () => void;
  canTurn: boolean;
  onTurnLeft: () => void;
  onTurnRight: () => void;
  onInfo: () => void;
  onMore: (bounds: { x: number; y: number; width: number; height: number } | undefined) => void;
  /** A file is open (it may still be loading, or not showable). Without one the toolbar holds nothing: there is nothing to act on. */
  hasFile: boolean;
  hasPicture: boolean;
  /** "Page" or "Image", for the names of Previous and Next. */
  unit: "Page" | "Image";
  /** The tools that fit, in drawing order (fold.ts); the others are rows of "…". All of them when left out. */
  shown?: readonly ToolId[];
}

function Divider() {
  const colors = useColors();
  return <View style={{ width: 1, height: 18, marginLeft: 3, marginRight: 3, backgroundColor: colors.separator }} />;
}

function Tool({ tool, props }: { tool: ToolId; props: ToolbarProps }) {
  const colors = useColors();
  const { hasPicture } = props;
  const unit = props.unit.toLowerCase();
  switch (tool) {
    case "move":
      return (
        <>
          <ToolbarButton glyph={glyphs.CHEVRON_LEFT} testID="previous" tooltip={`Previous ${unit}`} disabled={!props.canPrevious} onPress={props.onPrevious} />
          {props.position !== null && (
            <View testID="position" style={{ minWidth: 44, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
                {props.position}
              </Text>
            </View>
          )}
          <ToolbarButton glyph={glyphs.CHEVRON_RIGHT} testID="next" tooltip={`Next ${unit}`} disabled={!props.canNext} onPress={props.onNext} />
        </>
      );
    case "zoom":
      return (
        <>
          <ToolbarButton glyph={glyphs.ZOOM_OUT} testID="zoom-out" tooltip="Zoom out" disabled={!hasPicture} onPress={props.onZoomOut} />
          {props.zoomLabel !== "" && (
            // Centred between − and +, as the PDF's "3 / 12" is between the arrows.
            <View testID="zoom-level" style={{ minWidth: 46, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text, textAlign: "center" }}>
                {props.zoomLabel}
              </Text>
            </View>
          )}
          <ToolbarButton glyph={glyphs.ZOOM_IN} testID="zoom-in" tooltip="Zoom in" disabled={!hasPicture} onPress={props.onZoomIn} />
        </>
      );
    case "fit":
      return <ToolbarButton glyph={glyphs.FIT} testID="fit" tooltip="Zoom to fit" disabled={!hasPicture} onPress={props.onFit} />;
    case "actual":
      return <ToolbarButton glyph={glyphs.ACTUAL} testID="actual" tooltip="Actual size" disabled={!hasPicture} onPress={props.onActual} />;
    case "turn":
      return (
        <>
          <ToolbarButton glyph={glyphs.ROTATE_LEFT} testID="rotate-left" tooltip="Rotate left" disabled={!props.canTurn} onPress={props.onTurnLeft} />
          <ToolbarButton glyph={glyphs.ROTATE_RIGHT} testID="rotate-right" tooltip="Rotate right" disabled={!props.canTurn} onPress={props.onTurnRight} />
        </>
      );
    case "info":
      return <ToolbarButton glyph={glyphs.INFO} testID="info" tooltip="Get info" disabled={!hasPicture} onPress={props.onInfo} />;
  }
}

/**
 * The tools worth showing: all of them for a file that is shown; for one
 * that can't be (PA-6), only the arrows to the folder's other pictures, when
 * it has some. Zooming, turning and Info would have nothing to act on.
 */
export function toolsFor(tools: readonly ToolId[], { failed, canMove }: { failed: boolean; canMove: boolean }): ToolId[] {
  return failed ? tools.filter((tool) => tool === "move" && canMove) : [...tools];
}

/** The tools that didn't fit, as the first rows of "…", in drawing order, with their keys from the menu bar (menus.ts). */
export function foldedItems(folded: readonly ToolId[], props: ToolbarProps): MenuItem[] {
  const noPicture = !props.hasPicture;
  const rows: Readonly<Record<ToolId, MenuItem[]>> = {
    move: [
      { label: `Previous ${props.unit}`, keys: "←", onPress: props.onPrevious, disabled: !props.canPrevious },
      { label: `Next ${props.unit}`, keys: "→", onPress: props.onNext, disabled: !props.canNext },
    ],
    zoom: [
      { label: "Zoom Out", keys: "❖-", onPress: props.onZoomOut, disabled: noPicture },
      { label: "Zoom In", keys: "❖=", onPress: props.onZoomIn, disabled: noPicture },
    ],
    fit: [{ label: "Zoom to Fit", keys: "❖9", onPress: props.onFit, disabled: noPicture }],
    actual: [{ label: "Actual Size", keys: "❖0", onPress: props.onActual, disabled: noPicture }],
    turn: [
      { label: "Rotate Left", keys: "❖L", onPress: props.onTurnLeft, disabled: !props.canTurn },
      { label: "Rotate Right", keys: "❖R", onPress: props.onTurnRight, disabled: !props.canTurn },
    ],
    info: [{ label: "Get Info", keys: "❖I", onPress: props.onInfo, disabled: noPicture }],
  };
  return folded.flatMap((tool) => rows[tool]);
}

/** "…": the rest of the commands, in a menu that hangs from it. */
function MoreButton({ onMore }: { onMore: ToolbarProps["onMore"] }) {
  const colors = useColors();
  const tip = useTooltip("More");
  return (
    <View
      testID="more"
      focusable
      accessibilityRole="button"
      accessibilityLabel="More"
      onPress={(event) => {
        tip.hide();
        onMore(event.bounds);
      }}
      onHoverChange={tip.onHoverChange}
      style={{ height: 28, minWidth: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
    >
      <Svg markup={glyphs.MORE} size={16} color={colors.textMuted} />
      {tip.node}
    </View>
  );
}

export function PreviewToolbar(props: ToolbarProps) {
  // The empty window's way in is its Open… button and drops; a row of disabled glyphs would only say "not yet".
  if (!props.hasFile) return null;
  const shown = props.shown ?? TOOLS;
  return (
    <>
      {shown.map((tool) => (
        <Fragment key={tool}>
          {dividerBefore(shown, tool) && <Divider />}
          <Tool tool={tool} props={props} />
        </Fragment>
      ))}
      <MoreButton onMore={props.onMore} />
    </>
  );
}
