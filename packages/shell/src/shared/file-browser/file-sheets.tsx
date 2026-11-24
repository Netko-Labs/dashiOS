/**
 * Get Info and Open With, one sheet each (PA-18), shared by Files, Preview and
 * the chooser. Info is a form sheet (UI-15): the item's name as its heading,
 * its facts as a Group of rows that wrap, from the one formatter
 * (`format.ts`, PA-14), and Done. Open With is pick rows (UI-13): the default
 * tagged "Default" and chosen first, ↑ ↓ choose, Return or Open opens with
 * the chosen app, a press on another row chooses it, Cancel goes; "No other
 * app opens this kind of file." when there is none.
 */

import { FormSheet, Group, Loading, PICK_ROW, PickList, PickRow, Row, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { AppIcon } from "../apps/index.ts";

/** A fact: its label and its value. */
export type InfoRow = readonly [label: string, value: string];

/** Their widths: Info's rows have room to wrap a path; Open With's names are short. */
export const FILE_SHEET = { info: 460, openWith: 380, listHeight: 280 } as const;

/**
 * Info: the name, then `rows`; `status` in their place while they are read
 * ("Reading…"), or what went wrong (`failed`).
 */
export function InfoSheet({
  name,
  rows,
  status,
  failed = false,
  onClose,
}: {
  name: string;
  rows: readonly InfoRow[];
  status?: string;
  failed?: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <FormSheet
      testID="info-sheet"
      title={name}
      width={FILE_SHEET.info}
      buttons={[{ label: "Done", testID: "info-sheet:done", kind: "primary", onPress: onClose }]}
    >
      {status !== undefined ? (
        <Text style={{ fontSize: TYPE.secondary.size, color: failed ? colors.critical : colors.textMuted }}>{status}</Text>
      ) : (
        <Group testID="info-sheet:rows">
          {rows.map(([label, value]) => (
            <Row key={label} label={label} wraps>
              {/* Two thirds of the row, from a zero basis: a long value wraps there, the row grows with it, and the label stays on its first line. */}
              <View testID={`info-sheet:${label}`} style={{ flex: 2, minWidth: 0 }}>
                <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted, textAlign: "right" }}>{value}</Text>
              </View>
            </Row>
          ))}
        </Group>
      )}
    </FormSheet>
  );
}

/** An app that opens the file: its desktop id, name and icon; the default for this kind is tagged. */
export interface OpenWithChoice {
  id: string;
  name: string;
  icon: string;
  isDefault?: boolean;
}

/** The app chosen when the sheet opens: the default, else the first. */
export const firstChoice = (apps: readonly OpenWithChoice[]): string | null => (apps.find((app) => app.isDefault) ?? apps[0])?.id ?? null;

export function OpenWithSheet<T extends OpenWithChoice>({
  name,
  apps,
  onPick,
  onClose,
}: {
  /** The file's name: "Open “Report.pdf” with". */
  name: string;
  /** Null while they are looked for. */
  apps: readonly T[] | null;
  onPick: (app: T) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [chosen, setChosen] = useState<string | null>(null);
  const current = chosen ?? (apps ? firstChoice(apps) : null);
  const pick = (): void => {
    const app = apps?.find((each) => each.id === current);
    if (app) onPick(app);
  };
  return (
    <FormSheet
      testID="open-with"
      title={`Open “${name}” with`}
      width={FILE_SHEET.openWith}
      buttons={[
        { label: "Cancel", testID: "open-with:cancel", cancel: true, onPress: onClose },
        { label: "Open", testID: "open-with:open", kind: "primary", disabled: current === null, onPress: pick },
      ]}
    >
      {apps === null ? (
        <Loading testID="open-with:loading" inline label="Looking for apps…" />
      ) : apps.length === 0 ? (
        <View testID="open-with:none">
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>No other app opens this kind of file.</Text>
        </View>
      ) : (
        <View style={{ maxHeight: FILE_SHEET.listHeight, overflow: "scroll" }}>
          <PickList testID="open-with:list">
            {apps.map((app) => (
              <PickRow
                key={app.id}
                testID={`open-with:${app.id}`}
                label={app.name}
                chosen={app.id === current}
                {...(app.isDefault ? { detail: "Default" } : {})}
                picture={<AppIcon source={app.icon} resizeMode="contain" style={{ width: PICK_ROW.icon, height: PICK_ROW.icon }} />}
                onPress={() => (app.id === current ? onPick(app) : setChosen(app.id))}
              />
            ))}
          </PickList>
        </View>
      )}
    </FormSheet>
  );
}
