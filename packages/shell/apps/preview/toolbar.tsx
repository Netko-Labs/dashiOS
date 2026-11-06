/** Preview's toolbar buttons: moving, zooming, turning, and the rest; what doesn't fit is in "…" (fold.ts). */

import { type MenuItem, ToolbarButton, useColors } from "@dashi/ui";
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
  switch (tool) {
    case "move":
      return (
        <>
          <ToolbarButton glyph={glyphs.CHEVRON_LEFT} testID="previous" disabled={!props.canPrevious} onPress={props.onPrevious} />
          {props.position !== null && (
            <View style={{ minWidth: 44, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
                {props.position}
              </Text>
            </View>
          )}
          <ToolbarButton glyph={glyphs.CHEVRON_RIGHT} testID="next" disabled={!props.canNext} onPress={props.onNext} />
        </>
      );
    case "zoom":
      return (
        <>
          <ToolbarButton glyph={glyphs.ZOOM_OUT} testID="zoom-out" disabled={!hasPicture} onPress={props.onZoomOut} />
          {props.zoomLabel !== "" && (
            <View testID="zoom-level" style={{ minWidth: 46, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
                {props.zoomLabel}
              </Text>
            </View>
          )}
          <ToolbarButton glyph={glyphs.ZOOM_IN} testID="zoom-in" disabled={!hasPicture} onPress={props.onZoomIn} />
        </>
      );
    case "fit":
      return <ToolbarButton glyph={glyphs.FIT} testID="fit" disabled={!hasPicture} onPress={props.onFit} />;
    case "actual":
      return <ToolbarButton glyph={glyphs.ACTUAL} testID="actual" disabled={!hasPicture} onPress={props.onActual} />;
    case "turn":
      return (
        <>
          <ToolbarButton glyph={glyphs.ROTATE_LEFT} testID="rotate-left" disabled={!props.canTurn} onPress={props.onTurnLeft} />
          <ToolbarButton glyph={glyphs.ROTATE_RIGHT} testID="rotate-right" disabled={!props.canTurn} onPress={props.onTurnRight} />
        </>
      );
    case "info":
      return <ToolbarButton glyph={glyphs.INFO} testID="info" disabled={!hasPicture} onPress={props.onInfo} />;
  }
}

/** The tools that didn't fit, as the first rows of "…", in drawing order, with their keys from the menu bar (menus.ts). */
export function foldedItems(folded: readonly ToolId[], props: ToolbarProps, unit: "Image" | "Page"): MenuItem[] {
  const noPicture = !props.hasPicture;
  const rows: Readonly<Record<ToolId, MenuItem[]>> = {
    move: [
      { label: `Previous ${unit}`, keys: "❖[", onPress: props.onPrevious, disabled: !props.canPrevious },
      { label: `Next ${unit}`, keys: "❖]", onPress: props.onNext, disabled: !props.canNext },
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

export function PreviewToolbar(props: ToolbarProps) {
  const colors = useColors();
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
      <View
        testID="more"
        onPress={(event) => props.onMore(event.bounds)}
        style={{ height: 28, minWidth: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={glyphs.MORE} size={16} color={colors.textMuted} />
      </View>
    </>
  );
}
