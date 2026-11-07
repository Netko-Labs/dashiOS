/**
 * How a picture is looked at: fitted to the window or at a chosen scale, and
 * where it is panned to once it is larger than the window. A new file starts
 * fitted and centred; a rotation re-centres.
 */

import { useEffect, useRef, useState } from "react";
import type { Size } from "./dimensions.ts";
import type { Picture } from "./snapshot.ts";
import { clampPan, FIT, fitScale, type Pan, panAfterZoom, scaled, scaleOf, type ZoomMode, zoomIn, zoomOut } from "./zoom.ts";

export interface PictureView {
  scale: number;
  pan: Pan;
  area: Size;
  setPan(pan: Pan): void;
  setArea(area: Size): void;
  zoomTo(mode: ZoomMode): void;
  stepZoom(direction: 1 | -1): void;
}

export function usePictureView(picture: Picture | null, path: string | null, turns: number): PictureView {
  const [mode, setMode] = useState<ZoomMode>(FIT);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const fitted = picture ? fitScale(picture, area) : 1;
  const scale = scaleOf(mode, fitted);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different file resets the zoom and the pan
  useEffect(() => {
    setMode(FIT);
    setPan({ x: 0, y: 0 });
  }, [path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a rotation re-centres
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [turns]);

  // Keys can arrive several at once (a run of ❖=): each must see the zoom the one before it made.
  const live = useRef({ scale, pan, fitted, area, picture });
  live.current = { scale, pan, fitted, area, picture };
  const zoomTo = (next: ZoomMode): void => {
    const was = live.current;
    const to = scaleOf(next, was.fitted);
    const settled = was.picture ? clampPan(panAfterZoom(was.pan, was.scale, to), scaled(was.picture, to), was.area) : { x: 0, y: 0 };
    live.current = { ...was, scale: to, pan: settled };
    setMode(next);
    setPan(settled);
  };
  return {
    scale,
    pan,
    area,
    setPan,
    setArea: (next) => setArea((now) => (now.width === next.width && now.height === next.height ? now : next)),
    zoomTo,
    stepZoom: (direction) => {
      const now = live.current.scale;
      zoomTo({ kind: "scale", scale: direction > 0 ? zoomIn(now) : zoomOut(now) });
    },
  };
}
