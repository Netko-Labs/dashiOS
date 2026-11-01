/**
 * The assistant's pages in order, and where the person is. Pure: which
 * pages come up depends on what the machine has (no Wi-Fi page on a wired
 * computer), and Back and Continue walk only the pages that apply.
 */

export const PAGES = ["welcome", "language", "keyboard", "wifi", "timezone", "appearance", "agents", "done"] as const;
export type PageId = (typeof PAGES)[number];

export const isPageId = (value: unknown): value is PageId => PAGES.some((page) => page === value);

export interface PageInfo {
  id: PageId;
  title: string;
  /** What the page is about, under its title. */
  subtitle: string;
}

export const PAGE_INFO: Readonly<Record<PageId, PageInfo>> = {
  welcome: { id: "welcome", title: "Welcome to Dashi", subtitle: "A few quick choices to make this computer yours. You can skip any of them and change them later in System Settings." },
  language: { id: "language", title: "Language & Region", subtitle: "Pick a language for your apps, and the region whose dates and numbers you are used to." },
  keyboard: { id: "keyboard", title: "Keyboard", subtitle: "Try your keyboard in the box, and choose a layout if it is not the right one. A new layout applies in a moment." },
  wifi: { id: "wifi", title: "Wi-Fi", subtitle: "Join a network to get online. You can do this later from the menu bar." },
  timezone: { id: "timezone", title: "Time Zone", subtitle: "Pick the city you are in, so your clock reads right." },
  appearance: { id: "appearance", title: "Appearance", subtitle: "Light, dark, or following the time of day, and how round your windows are." },
  agents: { id: "agents", title: "Agents", subtitle: "Dashi lets AI agents help you, and you decide what they may do." },
  done: { id: "done", title: "You're all set", subtitle: "Enjoy Dashi. System Settings has everything you chose here, and more." },
};

/** What the machine has, which decides which pages apply. */
export interface Machine {
  /** Whether there is a Wi-Fi device to join a network with (false: wired only, or none). */
  wifi: boolean;
  /** Whether the computer is already online over a cable. */
  wired: boolean;
}

/** Whether a page applies on this machine. */
const applies = (page: PageId, machine: Machine): boolean => page !== "wifi" || (machine.wifi && !machine.wired);

/** The pages that apply on this machine, in order. */
export const pagesFor = (machine: Machine): PageId[] => PAGES.filter((page) => applies(page, machine));

export interface FlowView {
  page: PageId;
  /** 0-based position among the pages that apply. */
  index: number;
  count: number;
  first: boolean;
  last: boolean;
}

/** Where the person is. `machine` may change while the assistant is open (a cable goes in); the position holds. */
export class Flow {
  private current: PageId;
  private machine: Machine;
  private snapshot: FlowView;
  private readonly listeners = new Set<() => void>();

  constructor(machine: Machine, start: PageId = "welcome") {
    this.machine = machine;
    this.current = pagesFor(machine).includes(start) ? start : "welcome";
    this.snapshot = this.view();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FlowView => this.snapshot;

  private view(): FlowView {
    // A page that stopped applying while it was showing stays until it is left.
    const pages = PAGES.filter((page) => page === this.current || applies(page, this.machine));
    const index = pages.indexOf(this.current);
    return { page: this.current, index, count: pages.length, first: index === 0, last: index === pages.length - 1 };
  }

  private go(page: PageId): void {
    this.current = page;
    const next = this.view();
    const same = next.page === this.snapshot.page && next.index === this.snapshot.index && next.count === this.snapshot.count;
    this.snapshot = next;
    if (!same) for (const listener of this.listeners) listener();
  }

  setMachine(machine: Machine): void {
    if (machine.wifi === this.machine.wifi && machine.wired === this.machine.wired) return;
    this.machine = machine;
    this.go(this.current);
  }

  next(): void {
    const at = PAGES.indexOf(this.current);
    const page = PAGES.slice(at + 1).find((candidate) => applies(candidate, this.machine));
    if (page) this.go(page);
  }

  back(): void {
    const at = PAGES.indexOf(this.current);
    const page = PAGES.slice(0, at).reverse().find((candidate) => applies(candidate, this.machine));
    if (page) this.go(page);
  }

  /** Jump to a page (an agent's `open_setup_assistant` names one); a page that does not apply on this machine is ignored. */
  goto(page: PageId): void {
    if (applies(page, this.machine)) this.go(page);
  }
}
