// Settings › Wallpaper's saved videos (settings-app/lib/panes/wallpaper-live.tsx): looked up when the list changes, not on every draw.
import { expect, test } from "bun:test";
import { type NativeTransport, render, Text } from "@mirinjs/metal";
import { useState } from "react";
import { useVideoTiles } from "../src/settings-app/lib/panes/wallpaper-live.tsx";
import { settle } from "./support/time.ts";

test("the disk is asked about each saved video once per list, however often the section draws", async () => {
  const asked: string[] = [];
  const exists = (path: string): boolean => {
    asked.push(path);
    return true;
  };
  function Clips({ videos, draw }: { videos: string[]; draw: number }) {
    const tiles = useVideoTiles(videos, exists);
    return <Text>{`${draw}: ${tiles.map((tile) => tile.title).join(", ")}`}</Text>;
  }
  let show: (next: { videos: string[]; draw: number }) => void = () => {};
  function Section() {
    const [shown, setShown] = useState({ videos: ["/v/a.mp4", "/v/b.webm"], draw: 1 });
    show = setShown;
    return <Clips {...shown} />;
  }
  const transport: NativeTransport = { send() {}, onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<Section />, transport);
  await settle();
  // The same list in a new array (the settings are read again on every change to any key): no new look.
  show({ videos: ["/v/a.mp4", "/v/b.webm"], draw: 2 });
  await settle();
  expect(asked).toEqual(["/v/a.mp4", "/v/b.webm"]);
  show({ videos: ["/v/c.mov", "/v/a.mp4", "/v/b.webm"], draw: 3 });
  await settle();
  expect(asked).toEqual(["/v/a.mp4", "/v/b.webm", "/v/c.mov", "/v/a.mp4", "/v/b.webm"]);
  root.unmount();
});
