/**
 * Files' Get Info: the facts of one item, read in one go, and a folder's size
 * as the background count goes, shown in the shared Info sheet (PA-18,
 * `src/shared/file-browser/file-sheets.tsx`). Open With is that module's too;
 * naming happens in place (rename-field.tsx).
 */

import { useEffect, useState } from "react";
import { type InfoRow, InfoSheet } from "../../../../src/shared/file-browser/file-sheets.tsx";
import { formatCount, formatDate, formatSize } from "../../../../src/shared/file-browser/format.ts";
import { measure } from "../../../../src/shared/file-browser/size.ts";
import type { FileItem } from "../../../../src/shared/files/index.ts";
import { type ItemInfo as Facts, loadInfo } from "../info.ts";

/** "4.2 MB (4,201,337 bytes)": the rounded size and the exact one. */
const exactSize = (bytes: number): string => (bytes >= 1000 ? `${formatSize(bytes)} (${bytes.toLocaleString("en-US")} bytes)` : formatSize(bytes));

interface FolderSize {
  bytes: number;
  files: number;
  done: boolean;
}

/** The rows Info shows for what was read; a folder's size as far as it is counted. */
export function itemRows(info: Facts, folder: FolderSize | null): InfoRow[] {
  const size = info.isFolder
    ? folder === null
      ? "Calculating…"
      : `${exactSize(folder.bytes)}, ${formatCount(folder.files, "file")}${folder.done ? "" : " so far…"}`
    : exactSize(info.size ?? 0);
  return [
    ["Kind", info.kind],
    ["Size", size],
    ["Where", info.where],
    ...(info.target !== null ? ([["Points to", info.target]] as InfoRow[]) : []),
    ...(info.created !== null ? ([["Created", formatDate(info.created)]] as InfoRow[]) : []),
    ["Modified", formatDate(info.modified)],
    ["Last opened", formatDate(info.accessed)],
    ["Permissions", `${info.permissions} (${info.octal})`],
    ["Owner", `${info.owner}:${info.group}`],
  ];
}

/** Get Info on `item`: "Reading…" until its facts are in, then its rows. */
export function ItemInfo({ item, home, onClose }: { item: FileItem; home: string; onClose: () => void }) {
  const [info, setInfo] = useState<Facts | string | null>(null);
  const [folder, setFolder] = useState<FolderSize | null>(null);
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
  if (typeof info === "string") return <InfoSheet name={item.name} rows={[]} status={info} failed onClose={onClose} />;
  if (info === null) return <InfoSheet name={item.name} rows={[]} status="Reading…" onClose={onClose} />;
  return <InfoSheet name={item.name} rows={itemRows(info, folder)} onClose={onClose} />;
}
