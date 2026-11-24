/**
 * About: Dashi and the machine it runs on. It opens with its first card, not
 * a hero (SE-A33): the system's name and version first. A reading it can't
 * make leaves its row out; "Unknown" never shows (SE-17).
 */

import { useMemo } from "react";
import { Button, Group } from "../../../shared/cards/index.ts";
import type { PaneContext } from "../../context.ts";
import { Page } from "../../ui.tsx";
import { formatMemory, formatStorage, versionLine } from "../about.ts";
import { Setting } from "../setting.tsx";
import { Value } from "./parts.tsx";

export function AboutPane({ about, openSetup }: Pick<PaneContext, "about" | "openSetup">) {
  // Read once when the pane opens; none of it changes while Settings is up.
  const info = useMemo(() => about(), [about]);
  const cpu = info.processor ? `${info.processor.model}${info.processor.threads > 0 ? ` (${info.processor.threads} threads)` : ""}` : null;
  return (
    <Page title="About">
      <Group testID="about-system">
        <Setting id="about/version" title={info.os?.name ?? "Dashi"}>
          <Value testID="about-version">{versionLine(info)}</Value>
        </Setting>
        <Setting id="about/name">
          <Value>{info.hostname}</Value>
        </Setting>
        {info.base !== null && (
          <Setting id="about/based-on">
            <Value testID="about-base">{info.base}</Value>
          </Setting>
        )}
        <Setting id="about/kernel">
          <Value testID="about-kernel">{info.kernel}</Value>
        </Setting>
      </Group>
      <Group testID="about-hardware">
        {cpu !== null && (
          <Setting id="about/processor">
            <Value testID="about-cpu">{cpu}</Value>
          </Setting>
        )}
        <Setting id="about/memory">
          <Value testID="about-memory">{formatMemory(info.memory)}</Value>
        </Setting>
        {info.gpus.length > 0 && (
          <Setting id="about/graphics">
            <Value testID="about-gpu">{info.gpus}</Value>
          </Setting>
        )}
        {info.disk !== null && (
          <Setting id="about/storage" detail={`${formatStorage(info.disk.free)} available`}>
            <Value testID="about-disk">{formatStorage(info.disk.total)}</Value>
          </Setting>
        )}
      </Group>
      <Group testID="about-setup">
        <Setting id="about/setup-assistant">
          <Button testID="about-setup-open" label="Open…" onPress={openSetup} />
        </Setting>
      </Group>
    </Page>
  );
}
