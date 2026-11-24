/**
 * Dashi's own update, as its own row above Fedora's (flows/store row 7, 8):
 * "Dashi 0.9.1 · 6 parts", Update, and once it is in, "Log out to finish"
 * with Log out…. Its packages come from Dashi's COPR and update alone,
 * without Fedora's: a Dashi fix never waits behind a hundred Fedora packages.
 * No password: Dashi's source is already on (PackageKit's rule for updates).
 */

import { Button, Group, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { isDashiRepo } from "../../../src/shared/software/index.ts";
import { StateChip } from "./chip.tsx";
import { SectionHeader } from "./heading.tsx";
import { updateDashiJob } from "./package-actions.ts";
import { AppIcon, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";

/** "0.9.1" from Dashi's package version ("0.9.1~beta.20261116-1.fc44"). */
export const dashiVersion = (version: string): string => version.replace(/[~^-].*$/, "");

export function DashiUpdate({ onLogOut }: { onLogOut: () => void }) {
  const colors = useColors();
  const services = useServices();
  const actions = useActions();
  const { store } = services;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [finished, setFinished] = useState(false);
  const parts = (state.system?.updates ?? []).filter((update) => isDashiRepo(update.repo));
  const operation = state.operations.find((each) => each.key === "dashi");
  if (parts.length === 0 && !finished && !operation) return null;
  const main = parts.find((update) => update.name === "dashi") ?? parts[0];
  const title = main ? `Dashi ${dashiVersion(main.version)}` : "Dashi";
  const update = (): void => {
    const job = updateDashiJob(
      services,
      parts.map((each) => each.name),
    );
    store.enqueue({
      ...job,
      done: (outcome) => {
        job.done?.(outcome);
        if (outcome.ok) setFinished(true);
      },
    });
  };
  return (
    <>
      <SectionHeader title="Dashi" detail="Dashi itself, apart from Fedora’s packages" />
      <Group testID="dashi-update">
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset, minHeight: 60, paddingHorizontal: SPACE.inset, paddingVertical: SPACE.m }}>
          <AppIcon name="Dashi" size={44} />
          <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
            <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
              {finished && parts.length === 0 ? "Dashi is updated" : title}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
              {finished && parts.length === 0
                ? "Log out to finish: the apps on disk are new, and the session you are in is the old one."
                : `${parts.length} ${parts.length === 1 ? "part" : "parts"} · ${parts
                    .map((each) => each.name)
                    .slice(0, 4)
                    .join(", ")}${parts.length > 4 ? "…" : ""}`}
            </Text>
          </View>
          {operation ? (
            <StateChip chip={{ kind: "busy", operation }} testID="busy:dashi" onCancel={() => actions.cancel(operation.key)} />
          ) : finished && parts.length === 0 ? (
            <Button label="Log out…" testID="dashi-log-out" onPress={onLogOut} />
          ) : (
            <Button label="Update" testID="update-dashi" primary onPress={update} />
          )}
        </View>
      </Group>
    </>
  );
}
