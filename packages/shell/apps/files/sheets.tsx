/** Files' sheets: Get Info and Open With (naming happens in place, rename-field.tsx). Drawn inside the window by the kit's Sheet. */

import { Button, Group, Sheet, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { formatCount, formatDate, formatSize } from "./format.ts";
import { type ItemInfo, loadInfo } from "./info.ts";
import type { FileItem } from "./items.ts";
import type { OpenWithApp } from "./open.ts";
import { measure } from "./size.ts";

/** "4.2 MB (4,201,337 bytes)": the rounded size and the exact one. */
const exactSize = (bytes: number): string => (bytes >= 1000 ? `${formatSize(bytes)} (${bytes.toLocaleString("en-US")} bytes)` : formatSize(bytes));

/** One line of Get Info: a quiet label, the value at the end. Compact, so the sheet stays short. */
function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const colors = useColors();
  return (
    <View
      {...(testID ? { testID } : {})}
      style={{ height: 24, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}
    >
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text, textAlign: "right" }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** Get Info: what is known at once, and a folder's size as the background count goes. */
export function InfoSheet({ item, home, onClose }: { item: FileItem; home: string; onClose: () => void }) {
  const colors = useColors();
  const [info, setInfo] = useState<ItemInfo | string | null>(null);
  const [folder, setFolder] = useState<{ bytes: number; files: number; done: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadInfo(item, home).then(async (loaded) => {
      if (controller.signal.aborted) return;
      setInfo(loaded);
      if (typeof loaded === "string" || !loaded.isFolder) return;
      const result = await measure(
        item.path,
        controller.signal,
        (soFar) => !controller.signal.aborted && setFolder({ bytes: soFar.bytes, files: soFar.files, done: false }),
      );
      if (!controller.signal.aborted) setFolder({ bytes: result.bytes, files: result.files, done: true });
    });
    return () => controller.abort();
  }, [item, home]);
  const size =
    typeof info === "object" && info !== null
      ? info.isFolder
        ? folder === null
          ? "Calculating…"
          : `${exactSize(folder.bytes)}, ${formatCount(folder.files, "file")}${folder.done ? "" : " so far…"}`
        : exactSize(info.size ?? 0)
      : "";
  return (
    <Sheet testID="info-sheet" width={440} onCancel={onClose} onConfirm={onClose}>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`${item.name} Info`}</Text>
      </View>
      {typeof info === "string" ? (
        <Text style={{ fontSize: 12, color: colors.critical }}>{info}</Text>
      ) : info === null ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Reading…</Text>
      ) : (
        <View testID="info" style={{ flexShrink: 0, flexDirection: "column" }}>
          <Line label="Kind" value={info.kind} />
          <Line label="Size" value={size} testID="info:size" />
          <Line label="Where" value={info.where} />
          {info.target !== null && <Line label="Points to" value={info.target} />}
          {info.created !== null && <Line label="Created" value={formatDate(info.created)} />}
          <Line label="Modified" value={formatDate(info.modified)} />
          <Line label="Last opened" value={formatDate(info.accessed)} />
          <Line label="Permissions" value={`${info.permissions} (${info.octal})`} testID="info:permissions" />
          <Line label="Owner" value={`${info.owner}:${info.group}`} />
        </View>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button label="Done" testID="info-sheet:ok" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function OpenWithSheet({
  item,
  apps,
  onChoose,
  onCancel,
}: {
  item: FileItem;
  apps: readonly OpenWithApp[] | null;
  onChoose: (app: OpenWithApp) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  return (
    <Sheet testID="openwith-sheet" width={380} onCancel={onCancel}>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`Open “${item.name}” with`}</Text>
      {apps === null ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Looking for apps…</Text>
      ) : apps.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>No installed app says it can open this kind of file.</Text>
      ) : (
        <Group testID="openwith">
          {apps.map((app) => (
            <View
              key={app.id}
              testID={`openwith:${app.id}`}
              onPress={() => onChoose(app)}
              style={{ height: 34, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, hoverBackgroundColor: colors.button }}
            >
              <Image source={app.icon} resizeMode="contain" style={{ width: 22, height: 22 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
                  {app.name}
                </Text>
              </View>
            </View>
          ))}
        </Group>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button label="Cancel" testID="openwith-sheet:cancel" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
