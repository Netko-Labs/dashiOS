/**
 * The installer's rows, the parts the pages are made of: a disk the person
 * chooses, a labelled form field, and one step of the install's progress.
 * They take only Dashi's own components (@dashi/ui), so the pages (view.tsx)
 * can use them beside the Settings kit.
 */

import { CHECK, useColors, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Disk } from "./probe.ts";
import { sizeLabel } from "./probe.ts";

export function DiskRow({ disk, chosen, onChoose }: { disk: Disk; chosen: boolean; onChoose: () => void }) {
  const colors = useColors();
  const detail = disk.unavailable ?? [sizeLabel(disk.bytes), disk.removable ? "removable" : "", disk.path].filter(Boolean).join(" · ");
  return (
    <View
      testID={`installer-disk:${disk.path}`}
      onPress={disk.unavailable ? undefined : onChoose}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: chosen ? colors.selection : "transparent",
        opacity: disk.unavailable ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 1.5,
          borderColor: chosen ? colors.selection : colors.textMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {chosen && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.selection }} />}
      </View>
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{disk.name}</Text>
        <Text style={{ fontSize: 11, color: disk.unavailable ? colors.critical : colors.textMuted }}>{detail}</Text>
      </View>
    </View>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }}>
      <View style={{ width: 150 }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

export function StepRow({ label, mark }: { label: string; mark: "waiting" | "running" | "done" | "failed" }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 12 }}>
      <View style={{ width: 16, alignItems: "center" }}>
        {mark === "done" && <Svg markup={CHECK} size={13} color={colors.selection} />}
        {mark === "failed" && <Svg markup={WARNING} size={13} color={colors.critical} />}
        {mark === "running" && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.selection }} />}
      </View>
      <Text style={{ fontSize: 13, color: mark === "waiting" ? colors.textMuted : colors.text }}>{label}</Text>
    </View>
  );
}
