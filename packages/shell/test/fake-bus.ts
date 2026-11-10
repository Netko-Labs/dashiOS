/** A system bus in memory for the clients' tests: method handlers by path and member, and signals sent by hand. */

import type { BusLike, CallSpec, MatchRule, Message } from "../src/shared/dbus/index.ts";

type Handler = (body: readonly unknown[]) => unknown[] | Promise<unknown[]>;

export class FakeBus implements BusLike {
  readonly calls: CallSpec[] = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly subscriptions: Array<{ rule: MatchRule; handler: (message: Message) => void }> = [];

  /** Answers `member` of `iface` on `path`. */
  on(path: string, iface: string, member: string, handler: Handler): this {
    this.handlers.set(`${path} ${iface} ${member}`, handler);
    return this;
  }

  async call(spec: CallSpec): Promise<unknown[]> {
    this.calls.push(spec);
    const handler = this.handlers.get(`${spec.path} ${spec.interface} ${spec.member}`);
    if (!handler) throw new Error(`org.freedesktop.DBus.Error.ServiceUnknown: ${spec.destination ?? ""} ${spec.member}`);
    return handler(spec.body ?? []);
  }

  async subscribe(rule: MatchRule, handler: (message: Message) => void): Promise<() => Promise<void>> {
    const entry = { rule, handler };
    this.subscriptions.push(entry);
    return async () => {
      this.subscriptions.splice(this.subscriptions.indexOf(entry), 1);
    };
  }

  /** Sends a signal to every subscription whose rule names this path, interface, and member. */
  emit(path: string, iface: string, member: string, body: unknown[]): void {
    for (const { rule, handler } of [...this.subscriptions]) {
      if (rule.path !== undefined && rule.path !== path) continue;
      if (rule.interface !== undefined && rule.interface !== iface) continue;
      if (rule.member !== undefined && rule.member !== member) continue;
      handler({ path, interface: iface, member, body } as unknown as Message);
    }
  }

  /** As a link (dbus/link.ts): always this connection. */
  link(): { bus(): Promise<BusLike>; onConnect(setup: (bus: BusLike) => Promise<void> | void): () => void } {
    return {
      bus: async () => this,
      onConnect: (setup) => {
        void setup(this);
        return () => {};
      },
    };
  }

  callsTo(member: string): CallSpec[] {
    return this.calls.filter((call) => call.member === member);
  }
}

/** Lets the promises queued so far settle. */
