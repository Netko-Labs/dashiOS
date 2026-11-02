/**
 * A Metal host kept started with no window, so the next menu, sheet, or the
 * launcher shows at once: a new host spends seconds on its GPU context and
 * fonts before it can draw (mirin's deferred hosts, `MIRIN_METAL_DEFERRED`).
 * Taking it starts the next one a moment later. A host binary from before
 * deferred hosts is never kept warm: it would open a stray window.
 */

import {
	type NativeHostOptions,
	type NativeHostTransport,
	type NativeWindowOptions,
	spawnNativeHost,
} from "@mirinjs/metal";

type Spawn = (
	binary: string,
	options: NativeHostOptions,
) => NativeHostTransport;

/** How long after one is taken the next warm host starts, so the two don't compete. */
const REWARM_MS = 1500;

export class WarmHost {
	private spare: NativeHostTransport | null = null;
	private supported: Promise<boolean>;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	constructor(
		private readonly binary: string,
		supports: (binary: string) => Promise<boolean> = hostSupportsDeferred,
		private readonly spawn: Spawn = spawnNativeHost,
	) {
		this.supported = supports(binary).catch(() => false);
		void this.supported.then((ok) => {
			if (ok) this.warm();
		});
	}

	/** Resolves once it is known whether hosts are kept warm (tests). */
	ready(): Promise<boolean> {
		return this.supported;
	}

	/** The warm host with its window opened as `window`, or null when there is none ready. */
	take(window: NativeWindowOptions): NativeHostTransport | null {
		const host = this.spare;
		if (!host) return null;
		this.spare = null;
		host.open(window);
		this.later();
		return host;
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.spare?.close();
		this.spare = null;
	}

	private later(): void {
		if (this.timer || this.stopped) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.warm();
		}, REWARM_MS);
	}

	private warm(): void {
		if (this.spare || this.stopped) return;
		const host = this.spawn(this.binary, {
			appId: "dev.dashi.shell",
			deferred: true,
		});
		this.spare = host;
		// A warm host that dies (a crash, a GPU reset) is replaced, not handed out.
		host.onClose(() => {
			if (this.spare === host) {
				this.spare = null;
				this.later();
			}
		});
	}
}

/** Whether the host binary knows deferred windows: it names `MIRIN_METAL_DEFERRED`. */
export async function hostSupportsDeferred(binary: string): Promise<boolean> {
	const grep = Bun.spawn(["grep", "-aqF", "MIRIN_METAL_DEFERRED", binary], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await grep.exited) === 0;
}
