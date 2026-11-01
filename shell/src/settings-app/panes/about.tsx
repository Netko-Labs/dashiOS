/** About: Dashi and the machine it runs on. */

import { Svg, Text, View } from "@mirinjs/metal";
import { useMemo } from "react";
import { LOGO } from "../../glyphs.ts";
import { useColors } from "../../theme.ts";
import { formatMemory, formatStorage, versionLine } from "../about.ts";
import type { PaneContext } from "../context.ts";
import { Button, Group, Page, Row } from "../ui.tsx";

/** The value at the end of a row; several lines (two graphics adapters) stack. */
function Value({ children, testID }: { children: string | readonly string[]; testID?: string }) {
  const colors = useColors();
  const lines = typeof children === "string" ? [children] : children;
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
      {lines.map((line, index) => (
        // Lines of a value never reorder.
        <Text key={index} style={{ fontSize: 13, color: colors.textMuted, textAlign: "right" }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export function AboutPane({ about, openSetup }: Pick<PaneContext, "about" | "openSetup">) {
  const colors = useColors();
  // Read once when the pane opens; none of it changes while Settings is up.
  const info = useMemo(() => about(), [about]);
  const cpu = info.processor ? `${info.processor.model}${info.processor.threads > 0 ? ` (${info.processor.threads} threads)` : ""}` : "Unknown";
  return (
    <Page title="About">
      <View style={{ flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 4, paddingVertical: 8 }}>
        <Svg markup={LOGO} size={56} color={colors.selection} />
        <Text style={{ fontSize: 22, fontWeight: "bold", color: colors.text }}>{info.os?.name ?? "Dashi"}</Text>
        <View testID="about-version">
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{versionLine(info)}</Text>
        </View>
      </View>
      <Group testID="about-system">
        <Row label="Name">
          <Value>{info.hostname}</Value>
        </Row>
        {info.base !== null && (
          <Row label="Based on">
            <Value testID="about-base">{info.base}</Value>
          </Row>
        )}
        <Row label="Kernel">
          <Value testID="about-kernel">{info.kernel}</Value>
        </Row>
      </Group>
      <Group testID="about-hardware">
        <Row label="Processor">
          <Value testID="about-cpu">{cpu}</Value>
        </Row>
        <Row label="Memory">
          <Value testID="about-memory">{formatMemory(info.memory)}</Value>
        </Row>
        <Row label="Graphics">
          <Value testID="about-gpu">{info.gpus.length > 0 ? info.gpus : "Unknown"}</Value>
        </Row>
        <Row label="Storage" detail={info.disk ? `${formatStorage(info.disk.free)} available` : undefined}>
          <Value testID="about-disk">{info.disk ? formatStorage(info.disk.total) : "Unknown"}</Value>
        </Row>
      </Group>
      <Group testID="about-setup">
        <Row label="Setup Assistant" detail="Language, keyboard, Wi-Fi, time zone, appearance, and agents, one page at a time.">
          <Button testID="about-setup-open" label="Open…" onPress={openSetup} />
        </Row>
      </Group>
    </Page>
  );
}
