/**
 * The agent's brain: requests from polkitd come in one at a time to a sheet,
 * the helper checks what the person types, and the answer goes back to
 * polkitd as a method reply.
 *
 * - One authentication at a time; later requests wait their turn.
 * - Three wrong passwords end a request with `Failed`; Cancel, Esc, the sheet
 *   dying, or polkitd's `CancelAuthentication` end it with `Cancelled`.
 * - While the screen is locked no sheet is shown. A request waits for the
 *   unlock, but not forever: after `lockWaitMs` (two minutes) behind a lock it
 *   is answered `Cancelled`, so a program that asked for a privilege while
 *   nobody was there does not hang for the rest of the day. A sheet that is
 *   up when the screen locks is taken down (the helper is stopped, nothing
 *   typed survives) and its request goes back to the front of the line.
 */

import { DBusError } from "../dbus/index.ts";
import { type HelperEvent, type HelperProcess, startHelper } from "./helper.ts";
import { detailRows, RETRY, type SheetActions, SheetStore, type SheetUser } from "./model.ts";
import { type AuthRequest, orderUids, POLKIT_ERRORS } from "./request.ts";
import { type LookupUser, lookupUser, type PolkitUser } from "./users.ts";

export interface LockSignal {
  readonly isLocked: boolean;
  /** Called at every change; returns the function that stops it. */
  onChange(listener: (locked: boolean) => void): () => void;
}

export interface Presenter {
  /** Put the sheet up (replacing any other); `actions` are how it answers. */
  show(store: SheetStore, actions: SheetActions): void;
  hide(): void;
}

export interface ControllerOptions {
  presenter: Presenter;
  lock: LockSignal;
  /** The setuid helper's path. */
  helper: string;
  helperEnv?: Readonly<Record<string, string>>;
  /** The account at the keyboard; preferred when polkitd allows it. */
  me?: number;
  lookup?: LookupUser;
  /** An icon name from the request as a file, or null. */
  icon?: (name: string) => string | null;
  start?: typeof startHelper;
  lockWaitMs?: number;
  maxTries?: number;
}

/** Wrong passwords before a request fails. */
export const MAX_TRIES = 3;
export const LOCK_WAIT_MS = 120_000;
/** Requests held at once, running one included; polkitd never has more than a few. */
const MAX_PENDING = 16;
const MAX_USERS = 8;

interface Job {
  request: AuthRequest;
  users: PolkitUser[];
  user: PolkitUser;
  tries: number;
  helper: HelperProcess | null;
  store: SheetStore | null;
  lockTimer: ReturnType<typeof setTimeout> | null;
  done: boolean;
  resolve(): void;
  reject(error: DBusError): void;
}

const cancelled = (text: string): DBusError => new DBusError(POLKIT_ERRORS.cancelled, text);
const failed = (text: string): DBusError => new DBusError(POLKIT_ERRORS.failed, text);
const sheetUser = ({ uid, login, label }: PolkitUser): SheetUser => ({ uid, login, label });

export class PolkitController {
  private active: Job | null = null;
  private readonly queue: Job[] = [];
  /** Cookies whose users are being looked up; a cancel in that gap must still count. */
  private readonly resolving = new Set<string>();
  private closed = false;
  /** While every request is being cancelled, the next one must not get a sheet for a moment. */
  private draining = false;
  private readonly stopLockWatch: () => void;
  private readonly me: number;
  private readonly lookup: LookupUser;
  private readonly icon: (name: string) => string | null;
  private readonly start: typeof startHelper;
  private readonly lockWaitMs: number;
  private readonly maxTries: number;

  constructor(private readonly options: ControllerOptions) {
    this.me = options.me ?? process.getuid?.() ?? -1;
    this.lookup = options.lookup ?? lookupUser;
    this.icon = options.icon ?? (() => null);
    this.start = options.start ?? startHelper;
    this.lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS;
    this.maxTries = options.maxTries ?? MAX_TRIES;
    this.stopLockWatch = options.lock.onChange((locked) => this.lockChanged(locked));
  }

  /** `BeginAuthentication`: resolves when the person authenticated, rejects with the error to reply with. */
  async begin(request: AuthRequest): Promise<void> {
    const { cookie } = request;
    if (this.closed) throw cancelled("the agent is going away");
    if (this.resolving.has(cookie) || [this.active, ...this.queue].some((job) => job?.request.cookie === cookie)) {
      throw failed("that cookie is already being authenticated");
    }
    if (this.resolving.size + this.queue.length + (this.active ? 1 : 0) >= MAX_PENDING) throw failed("too many authentications are waiting");
    this.resolving.add(cookie);
    const found = await Promise.all(orderUids(request.uids, this.me).slice(0, MAX_USERS).map((uid) => this.lookup(uid)));
    // A CancelAuthentication (or closing) while the names were being looked up.
    if (!this.resolving.delete(cookie) || this.closed) throw cancelled("cancelled before it started");
    const users = found.filter((user): user is PolkitUser => user !== null);
    const [user] = users;
    if (!user) throw failed("nobody listed for this action has an account here");
    return new Promise<void>((resolve, reject) => {
      const job: Job = { request, users, user, tries: 0, helper: null, store: null, lockTimer: null, done: false, resolve, reject };
      this.queue.push(job);
      if (this.options.lock.isLocked) this.armLockTimer(job);
      this.pump();
    });
  }

  /** `CancelAuthentication`: polkitd no longer wants this one. */
  cancel(cookie: string): void {
    this.resolving.delete(cookie);
    const job = [this.active, ...this.queue].find((candidate) => candidate?.request.cookie === cookie);
    if (job) this.finish(job, cancelled("cancelled by polkit"));
  }

  /** Every request is moot: polkitd went away. */
  cancelAll(reason = "polkit went away"): void {
    this.resolving.clear();
    this.draining = true;
    for (const job of [this.active, ...this.queue]) if (job) this.finish(job, cancelled(reason));
    this.draining = false;
  }

  close(): void {
    this.closed = true;
    this.stopLockWatch();
    this.cancelAll("the agent is going away");
  }

  // The line.

  private pump(): void {
    if (this.closed || this.draining || this.active || this.options.lock.isLocked) return;
    const job = this.queue.shift();
    if (!job) return;
    this.disarmLockTimer(job);
    this.active = job;
    job.store = new SheetStore({
      message: job.request.message,
      icon: this.icon(job.request.iconName),
      users: job.users.map(sheetUser),
      user: job.user.uid,
      phase: "starting",
      prompt: "Password",
      echo: false,
      details: detailRows(job.request),
      detailsOpen: false,
      notice: null,
    });
    this.options.presenter.show(job.store, {
      submit: (password) => this.submit(job, password),
      cancel: () => this.finish(job, cancelled("the person cancelled")),
      pick: (uid) => this.pick(job, uid),
      toggleDetails: () => job.store?.set({ detailsOpen: !job.store.getSnapshot().detailsOpen }),
    });
    this.attempt(job);
  }

  private finish(job: Job, error: DBusError | null): void {
    if (job.done) return;
    job.done = true;
    job.helper?.stop();
    job.helper = null;
    this.disarmLockTimer(job);
    const queued = this.queue.indexOf(job);
    if (queued >= 0) this.queue.splice(queued, 1);
    if (this.active === job) {
      this.active = null;
      this.options.presenter.hide();
    }
    if (error) job.reject(error);
    else job.resolve();
    this.pump();
  }

  // One conversation with the helper.

  /** Starts a helper for the job's current user; the previous one, if any, is stopped. */
  private attempt(job: Job): void {
    job.helper?.stop();
    job.store?.set({ phase: "starting" });
    const helper: HelperProcess = this.start(
      { path: this.options.helper, user: job.user.login, cookie: job.request.cookie, ...(this.options.helperEnv ? { env: this.options.helperEnv } : {}) },
      (event) => {
        if (job.helper === helper && this.active === job) this.heard(job, event);
      },
    );
    job.helper = helper;
  }

  private heard(job: Job, event: HelperEvent): void {
    const store = job.store;
    switch (event.type) {
      case "prompt":
        // The sheet's field is labeled with PAM's wording, minus its colon.
        store?.set({ phase: "prompt", prompt: event.text.replace(/[:\s]+$/, "") || "Password", echo: event.echo });
        break;
      case "info":
      case "error":
        if (event.text) store?.set({ notice: { kind: event.type, text: event.text } });
        break;
      case "success":
        this.finish(job, null);
        break;
      case "failure":
        job.tries += 1;
        if (job.tries >= this.maxTries) {
          this.finish(job, failed("authentication failed"));
        } else {
          store?.set({ notice: { kind: "error", text: RETRY } });
          this.attempt(job);
        }
        break;
      case "exit":
        console.error(`dashi-shell: polkit: the authentication helper ended early (${event.code ?? "did not start"})`);
        this.finish(job, failed("the authentication helper stopped"));
        break;
    }
  }

  private submit(job: Job, password: string): void {
    const helper = job.helper;
    if (this.active !== job || !helper || job.store?.getSnapshot().phase !== "prompt") return;
    // One line goes to the helper; a newline would be taken for a second answer.
    if (/[\r\n\0]/.test(password)) {
      job.store.set({ notice: { kind: "error", text: "That password can't be used." } });
      return;
    }
    job.store.set({ phase: "checking", notice: null });
    void helper.respond(password).then((delivered) => {
      if (!delivered && job.helper === helper && this.active === job) this.heard(job, { type: "exit", code: null });
    });
  }

  private pick(job: Job, uid: number): void {
    const user = job.users.find((candidate) => candidate.uid === uid);
    if (this.active !== job || !user || user === job.user) return;
    job.user = user;
    job.tries = 0;
    job.store?.set({ user: uid, notice: null });
    this.attempt(job);
  }

  // The lock.

  private lockChanged(locked: boolean): void {
    if (this.closed) return;
    if (!locked) {
      for (const job of this.queue) this.disarmLockTimer(job);
      this.pump();
      return;
    }
    const job = this.active;
    if (job) {
      // Nothing typed so far survives, and no helper listens while the screen is locked.
      this.active = null;
      job.helper?.stop();
      job.helper = null;
      job.store = null;
      this.options.presenter.hide();
      this.queue.unshift(job);
    }
    for (const waiting of this.queue) this.armLockTimer(waiting);
  }

  private armLockTimer(job: Job): void {
    job.lockTimer ??= setTimeout(() => this.finish(job, cancelled("the screen stayed locked")), this.lockWaitMs);
  }

  private disarmLockTimer(job: Job): void {
    if (job.lockTimer) clearTimeout(job.lockTimer);
    job.lockTimer = null;
  }
}
