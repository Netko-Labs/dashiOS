/** How Activity Monitor writes its numbers: bytes, CPU time, percentages. */

const UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;

/** 1536 → "1.5 KB"; binary steps, as the Mac's Activity Monitor. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} bytes`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** A rate: "1.5 MB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds of CPU time as the Mac writes them: "4.52", "1:02.30", "3:04:05.67". */
export function formatCpuTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const hundredths = Math.round(seconds * 100);
  const h = Math.floor(hundredths / 360000);
  const m = Math.floor((hundredths % 360000) / 6000);
  const s = Math.floor((hundredths % 6000) / 100);
  const cs = String(hundredths % 100).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${cs}`;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${cs}`;
  return `${s}.${cs}`;
}

/** "12.3"; one decimal, as the % CPU column. */
export function formatPercent(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

/** 1234567 → "1,234,567". */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
