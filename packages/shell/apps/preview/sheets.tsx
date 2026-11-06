/** Preview's sheets: file info, the Open With list, and a plain message. */

import { Button, Sheet, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import type { Handler } from "./handlers.ts";
import { type FileFacts, formatBytes, formatDate, formatDimensions, megapixels } from "./info.ts";

export type InfoRow = readonly [label: string, value: string];

/** The facts about the open file, as rows. */
export function infoRows(facts: FileFacts, extra: readonly InfoRow[]): InfoRow[] {
  return [
    ["Name", facts.name],
    ["Kind", facts.type],
    ...extra,
    ["Size", `${formatBytes(facts.size)}${facts.size >= 1000 ? ` (${facts.size.toLocaleString("en-US")} bytes)` : ""}`],
    ["Modified", formatDate(facts.modifiedMs)],
    ["Where", facts.folder],
  ];
}

/** The rows an image adds: its size in pixels and megapixels. */
export function imageRows(width: number, height: number, turns: number): InfoRow[] {
  const mp = megapixels(width, height);
  return [
    ["Dimensions", `${formatDimensions(width, height)} pixels${mp ? ` (${mp})` : ""}`],
    ...(turns % 4 !== 0 ? ([["Viewing", `Turned ${turns % 4 === 1 ? "90° clockwise" : turns % 4 === 2 ? "180°" : "90° counterclockwise"}`]] as InfoRow[]) : []),
  ];
}

export function InfoSheet({ rows, onClose }: { rows: readonly InfoRow[]; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="info-sheet" width={440} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Info</Text>
      <View style={{ flexDirection: "column", gap: 8, marginTop: 2 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ width: 84, flexShrink: 0 }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 12, color: colors.text }}>{value}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
        <Button label="Done" testID="info-sheet:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function OpenWithSheet({
  handlers,
  loading,
  onPick,
  onClose,
}: {
  handlers: readonly Handler[];
  loading: boolean;
  onPick: (handler: Handler) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Sheet testID="open-with" width={380} onCancel={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Open With</Text>
      {loading ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Looking for apps…</Text>
      ) : handlers.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>No other app is installed for this kind of file.</Text>
      ) : (
        <View style={{ flexDirection: "column", gap: 2, maxHeight: 280, overflow: "scroll" }} testID="open-with:list">
          {handlers.map((handler) => (
            <View
              key={handler.id}
              testID={`open-with:${handler.id}`}
              onPress={() => onPick(handler)}
              style={{
                height: 30,
                flexShrink: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 8,
                borderRadius: 6,
                // A wash under the pointer, never kombu (CO-2).
                hoverBackgroundColor: colors.button,
              }}
            >
              <Image source={handler.icon} resizeMode="contain" style={{ width: 20, height: 20 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
                  {handler.name}
                </Text>
              </View>
              {handler.isDefault && <Text style={{ fontSize: 11, color: colors.textMuted }}>Default</Text>}
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
        <Button label="Cancel" testID="open-with:cancel" onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function MessageSheet({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="message" width={400} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{title}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{message}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
        <Button label="OK" testID="message:ok" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}
