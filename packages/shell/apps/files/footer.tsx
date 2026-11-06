/** The notice over the content's foot, only while it has something: running jobs with Cancel, and the last message. The path and the status line are the omnibox's. */

import { Button, Notice, useColors, useUndo } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useFiles, useFilesState, useJobs } from "./context.ts";
import { formatCount, formatSize } from "./format.ts";
import { CLOSE } from "./glyphs.ts";
import type { Job } from "./jobs.ts";

function JobRow({ job }: { job: Job }) {
  const colors = useColors();
  const { ops } = useFiles();
  const ratio = job.total && job.total > 0 ? Math.min(1, job.done / job.total) : null;
  return (
    <View testID={`job:${job.id}`} style={{ height: 30, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>{`${job.label}…`}</Text>
      </View>
      <View style={{ width: 160, height: 6, borderRadius: 3, backgroundColor: colors.button, overflow: "hidden" }}>
        <View
          testID={`job:${job.id}:bar`}
          style={{ width: ratio === null ? "35%" : `${Math.round(ratio * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.selection }}
        />
      </View>
      {ratio !== null && job.total !== null && job.total > 1000 && (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${formatSize(job.done)} of ${formatSize(job.total)}`}</Text>
      )}
      <View
        testID={`job:${job.id}:cancel`}
        onPress={() => ops.jobs.cancel(job.id)}
        style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={CLOSE} size={11} color={colors.textMuted} />
      </View>
    </View>
  );
}

/** "12 items, 41.3 GB available", or "3 of 12 selected, 4.2 MB". */
export function statusLine(total: number, selected: readonly { size: number; kind: string }[], free: number | null): string {
  if (selected.length > 0) {
    const bytes = selected.filter((item) => item.kind === "file").reduce((sum, item) => sum + item.size, 0);
    const size = selected.some((item) => item.kind === "file") ? `, ${formatSize(bytes)}` : "";
    return `${selected.length} of ${formatCount(total)} selected${size}`;
  }
  return free === null ? formatCount(total) : `${formatCount(total)}, ${formatSize(free)} available`;
}

export function Footer() {
  const { store, ops } = useFiles();
  const state = useFilesState();
  const undo = useUndo(ops.undo);
  const jobs = useJobs().filter((job) => job.state === "running");
  // It floats over the listing (AppWindow's notice) only while it has something to say; it is never a bar.
  if (jobs.length === 0 && !state.notice) return null;
  const notice = state.notice;
  // "Moved “a.txt” to the Trash." with Undo, while that is still what Undo takes back (design.html PA-2).
  const action =
    notice?.undoable && undo.canUndo ? <Button testID="footer:undo" label="Undo" disabled={undo.busy} onPress={() => void ops.undoStep("undo")} /> : undefined;
  return (
    <Notice
      testID="footer"
      text={notice?.text}
      tone={notice?.error ? "error" : "info"}
      action={action}
      onDismiss={notice ? () => store.dismissNotice() : undefined}
    >
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </Notice>
  );
}
