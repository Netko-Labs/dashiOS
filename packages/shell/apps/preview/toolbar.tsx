/** Preview's toolbar buttons: moving, zooming, turning, and the rest. */

import { ToolbarButton, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
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
}

function Divider() {
  const colors = useColors();
  return <View style={{ width: 1, height: 18, marginLeft: 3, marginRight: 3, backgroundColor: colors.separator }} />;
}

export function PreviewToolbar(props: ToolbarProps) {
  const colors = useColors();
  const { hasPicture } = props;
  // The empty window's way in is its Open… button and drops; a row of disabled glyphs would only say "not yet".
  if (!props.hasFile) return null;
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
      <Divider />
      <ToolbarButton glyph={glyphs.ZOOM_OUT} testID="zoom-out" disabled={!hasPicture} onPress={props.onZoomOut} />
      {props.zoomLabel !== "" && (
        <View testID="zoom-level" style={{ minWidth: 46, alignItems: "center" }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
            {props.zoomLabel}
          </Text>
        </View>
      )}
      <ToolbarButton glyph={glyphs.ZOOM_IN} testID="zoom-in" disabled={!hasPicture} onPress={props.onZoomIn} />
      <ToolbarButton glyph={glyphs.FIT} testID="fit" disabled={!hasPicture} onPress={props.onFit} />
      <ToolbarButton glyph={glyphs.ACTUAL} testID="actual" disabled={!hasPicture} onPress={props.onActual} />
      <Divider />
      <ToolbarButton glyph={glyphs.ROTATE_LEFT} testID="rotate-left" disabled={!props.canTurn} onPress={props.onTurnLeft} />
      <ToolbarButton glyph={glyphs.ROTATE_RIGHT} testID="rotate-right" disabled={!props.canTurn} onPress={props.onTurnRight} />
      <Divider />
      <ToolbarButton glyph={glyphs.INFO} testID="info" disabled={!hasPicture} onPress={props.onInfo} />
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
