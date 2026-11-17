/** Music (the sleeve's colour): the album print, title and artist, where it is, and play, pause, next, previous. */

import { useDark } from "@dashi/ui";
import { Dots, Svg, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { DotRow, dotsInset } from "../../../shared/inks/index.ts";
import { useHostAbilities } from "../../../shared/metal/index.ts";
import { useSecondTick } from "../../../tally/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { useCard } from "../../look.tsx";
import { Btn, Grow, Head, Lab, Meta, NowTag, Title, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { useSource } from "../data.ts";
import { ART_GRID, coverPrint, halftone, halftoneLayers, type Print, stockPrint } from "../sources/art.ts";
import { positionAt } from "../sources/media.ts";

const mmss = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** The print for a track: the cover's when it can be read, else a stock one, kept per address. */
function usePrint(art: string, title: string): Print {
  const [print, setPrint] = useState<Print>(() => stockPrint(title));
  useEffect(() => {
    let live = true;
    setPrint(stockPrint(title));
    if (art) void coverPrint(art).then((made) => live && made && setPrint(made));
    return () => {
      live = false;
    };
  }, [art, title]);
  return print;
}

/** The print in `<Dots>`: a layer per dot size and colour, each padded so its dots sit in their cells. */
function DotPrint({ print, size, sleeve }: { print: Print; size: number; sleeve: string }) {
  const c = useCard();
  const layers = useMemo(() => halftoneLayers(print), [print]);
  const pitch = size / ART_GRID;
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.off }}>
      {layers.map((layer) => (
        <View key={`${layer.colour}:${layer.radius}`} style={{ position: "absolute", left: 0, top: 0, padding: dotsInset(pitch, layer.radius * pitch) }}>
          <Dots
            count={ART_GRID}
            rows={ART_GRID}
            pitch={pitch}
            radius={layer.radius * pitch}
            cells={layer.cells}
            color={layer.colour === "sleeve" ? sleeve : c.ink}
          />
        </View>
      ))}
    </View>
  );
}

function Halftone({ print, size, sleeve }: { print: Print; size: number; sleeve: string }) {
  const { dots } = useHostAbilities();
  return dots ? <DotPrint print={print} size={size} sleeve={sleeve} /> : <MaskPrint print={print} size={size} sleeve={sleeve} />;
}

/** The print as two masks, on a host from before `<Dots>`. */
function MaskPrint({ print, size, sleeve }: { print: Print; size: number; sleeve: string }) {
  const c = useCard();
  const masks = useMemo(() => halftone(print), [print]);
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.off }}>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg markup={masks.ink} size={size} color={c.ink} />
      </View>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg markup={masks.sleeve} size={size} color={sleeve} />
      </View>
    </View>
  );
}

export function MediaWidget({ size, air }: { size: WidgetSize; air: boolean }) {
  const { hub, inks } = useWidgetEnv();
  const c = useCard();
  const playing = useSource(hub?.media, null);
  const now = useSecondTick(playing?.playing === true);
  const print = usePrint(playing?.art ?? "", playing?.title ?? "");
  const dark = useDark();
  if (!playing)
    return (
      <>
        <Head left={<Lab>Music</Lab>} />
        <Grow />
        <Words>Nothing is playing</Words>
      </>
    );
  const sleeve = air ? c.ink : print.sleeve ? (dark ? print.sleeve.dark : print.sleeve.light) : c.value;
  const at = positionAt(playing, now);
  const share = playing.length > 0 ? at / playing.length : 0;
  const command = (member: "PlayPause" | "Next" | "Previous") => () => void hub?.media.command(member).catch(() => {});
  const controls = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
      <Btn icon="prev" round onPress={command("Previous")} testID="media-prev" />
      <Btn icon={playing.playing ? "pause" : "play"} round fill onPress={command("PlayPause")} testID="media-play" />
      <Btn icon="next" round onPress={command("Next")} testID="media-next" />
    </View>
  );
  if (size === "small")
    return (
      <>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Halftone print={print} size={56} sleeve={sleeve} />
          <View style={{ flex: 1, flexDirection: "column" }}>
            <Title>{playing.title}</Title>
            <Words>{playing.artist}</Words>
          </View>
        </View>
        <Grow />
        <DotRow count={20} value={share} pitch={7.2} radius={0.32} lit={c.value} unlit={c.off} />
        {controls}
      </>
    );
  return (
    <View style={{ flexDirection: "row", gap: 14, flex: 1 }}>
      <Halftone print={print} size={144} sleeve={sleeve} />
      <View style={{ flex: 1, flexDirection: "column" }}>
        <Head left={<Lab>Music</Lab>} right={air ? <NowTag tally={inks.tally} /> : <Meta max={16}>{playing.name}</Meta>} />
        <View style={{ height: 10 }} />
        <Title size={15}>{playing.title}</Title>
        <Words>{playing.artist}</Words>
        <Grow />
        <DotRow count={23} value={share} pitch={7.3} radius={0.32} lit={c.value} unlit={c.off} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          <Meta>{mmss(at)}</Meta>
          <Meta>{playing.length > 0 ? `−${mmss(playing.length - at)}` : ""}</Meta>
        </View>
        {controls}
      </View>
    </View>
  );
}
