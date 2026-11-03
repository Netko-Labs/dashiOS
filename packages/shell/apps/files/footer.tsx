/** The strip under the content, only while it has something: running jobs with Cancel, and the last message. The path and the status line are the omnibox's. */

import { useColors } from "@dashi/ui";
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

function NoticeRow() {
  const colors = useColors();
  const { store } = useFiles();
  const { notice } = useFilesState();
  if (!notice) return null;
  return (
    <View testID="notice" style={{ minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 4 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: notice.error ? colors.critical : colors.textMuted }}>{notice.text}</Text>
      </View>
      <View
        testID="notice:close"
        onPress={() => store.dismissNotice()}
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
  const colors = useColors();
  const state = useFilesState();
  const jobs = useJobs().filter((job) => job.state === "running");
  // Vertical space is the listing's: the strip is there only while it has something to say.
  if (jobs.length === 0 && !state.notice) return null;
  return (
    <View testID="footer" style={{ flexShrink: 0, flexDirection: "column", borderTopWidth: 1, borderColor: colors.separator }}>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
      <NoticeRow />
    </View>
  );
}
