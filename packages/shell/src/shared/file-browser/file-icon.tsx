/**
 * An item's icon as every browser draws it (IC-2): Dashi's page or folder in
 * the window's appearance, and on a page of no known category, big enough to
 * read, its extension as a label ("ERR", "DONE").
 */

import { TINTS, useDark } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { type FileItem, splitName } from "../files/index.ts";
import { iconKind } from "./lib/file-icons.ts";
import { type Emblems, iconFor } from "./lib/icons.ts";

/** The label an unknown type's page shows: its extension, capitals, at most five letters; none without one. */
export function extensionLabel(name: string): string | null {
  const { ext } = splitName(name);
  const label = ext.slice(1).toUpperCase();
  return label === "" || label.includes(".") ? null : label.slice(0, 5);
}

export function FileIcon({ item, size, emblems }: { item: Pick<FileItem, "kind" | "mime" | "path" | "name">; size: number; emblems?: Emblems }) {
  const dark = useDark();
  const kind = iconKind(item);
  const label = !kind.folder && kind.category === "other" && size >= 32 ? extensionLabel(item.name) : null;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Image source={iconFor(item, dark, emblems)} resizeMode="contain" style={{ width: size, height: size }} />
      {label !== null && (
        <View
          style={{
            position: "absolute",
            bottom: Math.round(size * 0.2),
            paddingHorizontal: Math.max(3, Math.round(size * 0.05)),
            borderRadius: 3,
            backgroundColor: TINTS.goma,
          }}
        >
          <Text style={{ fontSize: Math.max(8, Math.round(size * 0.16)), fontWeight: "bold", color: "#ffffff" }}>{label}</Text>
        </View>
      )}
    </View>
  );
}
