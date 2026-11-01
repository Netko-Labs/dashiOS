/** How Files writes sizes and dates (the Mac's: decimal units, "Today at 14:32"). */

const UNITS = ["KB", "MB", "GB", "TB", "PB"] as const;

/** `formatSize(1234)` is "1 KB", `formatSize(4_200_000)` "4.2 MB"; under a thousand it is bytes. Decimal units, as macOS and GNOME write them. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "Zero bytes";
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // KB are whole, bigger units get a decimal under 100 (4.2 MB, 42.1 MB, 420 MB).
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[unit]}`;
}

/** `3 items`, `1 item`. */
export function formatCount(count: number, noun = "item"): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface DateFormat {
  locale?: string | undefined;
  /** Milliseconds; defaults to now. */
  now?: number;
  hour12?: boolean | undefined;
}

const startOfDay = (time: number): number => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** "Today at 14:32", "Yesterday at 09:05", "Oct 3, 2026 at 10:00" (the year left out within the year). */
export function formatDate(time: number, options: DateFormat = {}): string {
  if (!Number.isFinite(time) || time <= 0) return "—";
  const now = options.now ?? Date.now();
  const clock = new Date(time).toLocaleTimeString(options.locale, { hour: options.hour12 === false ? "2-digit" : "numeric", minute: "2-digit", ...(options.hour12 !== undefined ? { hour12: options.hour12 } : {}) });
  const today = startOfDay(now);
  const day = startOfDay(time);
  const days = Math.round((today - day) / 86_400_000);
  if (days === 0) return `Today at ${clock}`;
  if (days === 1) return `Yesterday at ${clock}`;
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  const date = new Date(time).toLocaleDateString(options.locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${date} at ${clock}`;
}

const PERMISSION_BITS = ["r", "w", "x"] as const;

/** `rwxr-xr-x` for a mode's low nine bits, with setuid, setgid, and sticky shown as `s`/`t`. */
export function permissionString(mode: number): string {
  let out = "";
  for (let shift = 6; shift >= 0; shift -= 3) {
    const triple = (mode >> shift) & 7;
    for (let bit = 0; bit < 3; bit++) out += triple & (4 >> bit) ? PERMISSION_BITS[bit] : "-";
  }
  const chars = [...out];
  const special = (index: number, flag: number, letter: string): void => {
    if (!(mode & flag)) return;
    chars[index] = chars[index] === "x" ? letter : letter.toUpperCase();
  };
  special(2, 0o4000, "s");
  special(5, 0o2000, "s");
  special(8, 0o1000, "t");
  return chars.join("");
}

export function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

/** `middleEllipsis("A very long file name.txt", 16)` is "A very l…name.txt": names keep their ends, where the extension is. */
export function middleEllipsis(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = max - 1;
  const tail = Math.ceil(keep / 2);
  const head = keep - tail;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}
