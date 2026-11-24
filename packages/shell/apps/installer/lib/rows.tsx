/**
 * The installer's rows, in the panel look Settings' cards use (TK-2): the
 * disks as one selectable list (CO-9: the selection wash and its bar, ↑ ↓
 * choose), a labelled form row, a row with a line under its name and a
 * control at its end, and one step of the install's progress (done in moss,
 * the running one the kit's Spinner, never the accent: CO-2).
 */

import { CHECK, ControlName, OPACITY, rowLook, SelectionBar, SPACE, Spinner, TYPE, useColors, useControlColors, WARNING, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Disk } from "./probe.ts";
import { sizeLabel } from "./probe.ts";

/** A row of the installer's cards: Settings' row (56 tall, 16 in), and a form row's label column. */
export const INSTALLER_ROW = { height: 56, inset: SPACE.page, label: 150, mark: 16 } as const;

function DiskRow({ disk, chosen, onChoose }: { disk: Disk; chosen: boolean; onChoose: () => void }) {
  const colors = useColors();
  const look = rowLook(colors, chosen);
  const detail = disk.unavailable ?? [sizeLabel(disk.bytes), disk.removable ? "removable" : "", disk.path].filter(Boolean).join(" · ");
  return (
    <View
      testID={`installer-disk:${disk.path}`}
      focusable={!disk.unavailable}
      accessibilityRole="option"
      accessibilityLabel={`${disk.name}, ${detail}`}
      accessibilityState={{ selected: chosen, disabled: disk.unavailable !== undefined }}
      onPress={disk.unavailable ? undefined : onChoose}
      style={{
        position: "relative",
        minHeight: INSTALLER_ROW.height,
        flexDirection: "column",
        justifyContent: "center",
        gap: SPACE.xxs,
        paddingHorizontal: INSTALLER_ROW.inset,
        paddingVertical: SPACE.m,
        backgroundColor: look.ground,
        hoverBackgroundColor: disk.unavailable ? look.ground : look.hover,
        focusRingColor: colors.focusRing,
        ...(disk.unavailable ? { opacity: OPACITY.disabled } : {}),
      }}
    >
      {chosen && <SelectionBar />}
      <Text style={{ fontSize: TYPE.panel.name.size, lineHeight: TYPE.panel.name.line, fontWeight: WEIGHT.semibold, color: look.ink }}>{disk.name}</Text>
      <Text style={{ fontSize: TYPE.panel.detail.size, lineHeight: TYPE.panel.detail.line, color: disk.unavailable ? colors.critical : look.quiet }}>
        {detail}
      </Text>
    </View>
  );
}

/** The disks, one list: a focus group whose arrows move the choice, as a list's do. */
export function DiskList({ disks, chosen, onChoose }: { disks: readonly Disk[]; chosen: string | null; onChoose: (path: string) => void }) {
  return (
    <View testID="installer-disk-list" focusGroup selectsOnFocus accessibilityRole="listbox" accessibilityLabel="Disks" style={{ flexDirection: "column" }}>
      {disks.map((each) => (
        <DiskRow key={each.path} disk={each} chosen={each.path === chosen} onChoose={() => onChoose(each.path)} />
      ))}
    </View>
  );
}

/** A form's row: its label, then the field, which takes the label as its name. */
export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  const colors = useControlColors();
  return (
    <ControlName.Provider value={label}>
      <View style={{ minHeight: INSTALLER_ROW.height, flexDirection: "row", alignItems: "center", gap: SPACE.inset, paddingHorizontal: INSTALLER_ROW.inset }}>
        <View style={{ width: INSTALLER_ROW.label, flexShrink: 0 }}>
          <Text style={{ fontSize: TYPE.panel.name.size, lineHeight: TYPE.panel.name.line, fontWeight: WEIGHT.semibold, color: colors.text }}>{label}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
    </ControlName.Provider>
  );
}

/** A row with its name, a quieter line under it, and a control at its end (named by the row). */
export function InfoRow({ label, detail, children }: { label: string; detail?: string; children?: ReactNode }) {
  const colors = useControlColors();
  return (
    <ControlName.Provider value={label}>
      <View
        style={{
          minHeight: INSTALLER_ROW.height,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.inset,
          paddingHorizontal: INSTALLER_ROW.inset,
          paddingVertical: SPACE.m,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xxs }}>
          <Text style={{ fontSize: TYPE.panel.name.size, lineHeight: TYPE.panel.name.line, fontWeight: WEIGHT.semibold, color: colors.text }}>{label}</Text>
          {detail !== undefined && <Text style={{ fontSize: TYPE.panel.detail.size, lineHeight: TYPE.panel.detail.line, color: colors.muted }}>{detail}</Text>}
        </View>
        {children}
      </View>
    </ControlName.Provider>
  );
}

export type StepMark = "waiting" | "running" | "done" | "failed";

export function StepRow({ label, mark, testID }: { label: string; mark: StepMark; testID: string }) {
  const colors = useColors();
  const panel = useControlColors();
  return (
    <View
      testID={testID}
      accessibilityLabel={`${label}, ${mark}`}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, paddingVertical: SPACE.m, paddingHorizontal: INSTALLER_ROW.inset }}
    >
      <View style={{ width: INSTALLER_ROW.mark, height: INSTALLER_ROW.mark, alignItems: "center", justifyContent: "center" }}>
        {mark === "done" && <Svg markup={CHECK} size={INSTALLER_ROW.mark} color={colors.moss} />}
        {mark === "failed" && <Svg markup={WARNING} size={INSTALLER_ROW.mark} color={colors.critical} />}
        {mark === "running" && <Spinner size={INSTALLER_ROW.mark} testID={`${testID}:running`} />}
      </View>
      <Text style={{ fontSize: TYPE.panel.body.size, lineHeight: TYPE.panel.body.line, color: mark === "waiting" ? panel.muted : panel.text }}>{label}</Text>
    </View>
  );
}
