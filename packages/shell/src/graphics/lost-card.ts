/**
 * Noticing that the graphics card fell off the bus. On the reference laptop
 * (2026-11-03 23:42 and 2026-11-04 16:59) the card's PCIe port reported
 * pciehp "Link Down", then NVIDIA's driver Xid 79 ("GPU has fallen off the
 * bus"); every process touching the card hung in the driver. The kernel log
 * says so, and the shell follows it:
 *
 *   journalctl -k -b 0 -f -o json
 *
 * The journal, not /dev/kmsg: Fedora sets kernel.dmesg_restrict=1, so
 * /dev/kmsg needs CAP_SYSLOG, while the system journal is readable by the
 * wheel and adm groups (an ACL systemd sets), which the person who installed
 * the machine is in. Without that access journalctl shows no kernel lines and
 * there is simply nothing to notice. From the boot's start, so a shell
 * restarted after the loss still knows.
 *
 * Only the card's own lines count: Xid 79 naming its PCI address, and
 * "Link Down" on the port above it (another slot's link, a Wi-Fi card's say,
 * comes and goes on its own). Said once, plainly, per boot.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { watchLines } from "../system/watch.ts";

export interface KernelLine {
  message: string;
  /** `_KERNEL_DEVICE`: `+pci:0000:00:03.1`. */
  device: string | null;
}

/** One line of `journalctl -o json`; null for anything that isn't a kernel message. MESSAGE may come as bytes (an array) when it isn't UTF-8. */
export function parseJournalLine(line: string): KernelLine | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const raw = record.MESSAGE;
  const message =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw) && raw.every((byte) => typeof byte === "number" && byte >= 0 && byte < 256)
        ? new TextDecoder().decode(Uint8Array.from(raw as number[]))
        : null;
  if (message === null) return null;
  const device = typeof record._KERNEL_DEVICE === "string" ? record._KERNEL_DEVICE : null;
  return { message, device };
}

/** The card a loss is about: its PCI address (0000:64:00.0) and its port (0000:00:03.1). */
export interface CardPlace {
  pci: string;
  port: string | null;
}

export type Loss = "xid-79" | "link-down";

/** `NVRM: Xid (PCI:0000:64:00): 79, pid=…, name=…, GPU has fallen off the bus.` The address leaves out the function. */
const XID = /^NVRM: Xid \(PCI:([0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})(?:\.[0-7])?\): (\d+)\b/;
/** `pcieport 0000:00:03.1: pciehp: Slot(0-2): Link Down` */
const LINK_DOWN = /^pcieport ([0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]): pciehp: Slot\([^)]*\): Link Down\b/;

/** Whether `line` says this card is lost, and how. */
export function lossIn(line: KernelLine, card: CardPlace): Loss | null {
  const xid = XID.exec(line.message);
  if (xid) {
    const [, address, code] = xid;
    return code === "79" && address !== undefined && card.pci.toLowerCase().startsWith(`${address.toLowerCase()}.`) ? "xid-79" : null;
  }
  const down = LINK_DOWN.exec(line.message);
  if (down && card.port !== null) return down[1]?.toLowerCase() === card.port.toLowerCase() ? "link-down" : null;
  return null;
}

/** The plain words, for the notice and the menu. */
export const LOST_NOTICE = {
  summary: "The graphics card stopped responding",
  body: "Apps using it can't continue. Save your work and restart to bring it back. Apps on the built-in graphics keep working.",
} as const;

export interface LostCardOptions {
  /** Follows the kernel log; for tests. */
  follow?: (onLine: (line: string) => void) => () => void;
  /** Where "already said this boot" is kept: the runtime directory, which a reboot empties. */
  markerPath?: string | null;
}

const runtimeMarker = (): string | null => (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "dashi", "lost-card") : null);

/** Follows the kernel log for one card; `lost` turns true once and stays. */
export class LostCardWatch {
  private lostBy: Loss | null = null;
  private readonly listeners = new Set<(loss: Loss) => void>();
  private stop: (() => void) | null = null;
  private readonly marker: string | null;

  constructor(
    private readonly card: CardPlace,
    private readonly options: LostCardOptions = {},
  ) {
    this.marker = options.markerPath === undefined ? runtimeMarker() : options.markerPath;
  }

  get lost(): Loss | null {
    return this.lostBy;
  }

  /** Whether this boot's loss was already announced (by this shell or one before it). */
  get announced(): boolean {
    return this.marker !== null && existsSync(this.marker);
  }

  /** Remembers that the loss was announced, so a restarted shell doesn't say it again. */
  markAnnounced(): void {
    if (this.marker === null) return;
    try {
      mkdirSync(join(this.marker, ".."), { recursive: true });
      writeFileSync(this.marker, `${this.lostBy ?? "lost"}\n`);
    } catch {
      // Not remembered: at worst said again after a shell restart.
    }
  }

  onLost(listener: (loss: Loss) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    const follow = this.options.follow ?? ((onLine) => watchLines(["journalctl", "-k", "-b", "0", "-f", "-o", "json", "--no-pager"], onLine));
    this.stop ??= follow((text) => this.line(text));
  }

  /** One line of the log (exposed for the watch's own follow, and tests). */
  line(text: string): void {
    if (this.lostBy !== null) return;
    const line = parseJournalLine(text);
    const loss = line ? lossIn(line, this.card) : null;
    if (!loss) return;
    this.lostBy = loss;
    for (const listener of [...this.listeners]) listener(loss);
  }

  close(): void {
    this.stop?.();
    this.stop = null;
    this.listeners.clear();
  }
}
