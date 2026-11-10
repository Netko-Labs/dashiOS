/**
 * Match rules and the local side of signal delivery. The bus filters what it
 * sends us by the rules we `AddMatch`; because several handlers can share one
 * connection, each message is also checked here against each handler's own
 * rule, so a handler only sees what it asked for.
 */

import { type Message, MessageType } from "../message.ts";
import type { MatchRule } from "../types.ts";

const TYPE_CODES = {
  signal: MessageType.Signal,
  method_call: MessageType.MethodCall,
  method_return: MessageType.MethodReturn,
  error: MessageType.Error,
} as const;

/** The rule in the bus's text form: `key='value'` pairs, quotes escaped. */
export function matchRuleString(rule: MatchRule): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const parts: string[] = [];
  const add = (key: string, value: string | undefined) => {
    if (value !== undefined) parts.push(`${key}=${quote(value)}`);
  };
  add("type", rule.type);
  add("sender", rule.sender);
  add("interface", rule.interface);
  add("member", rule.member);
  add("path", rule.path);
  add("path_namespace", rule.pathNamespace);
  add("destination", rule.destination);
  for (const [index, value] of Object.entries(rule.args ?? {})) add(`arg${index}`, value);
  return parts.join(",");
}

const underNamespace = (path: string, namespace: string): boolean => namespace === "/" || path === namespace || path.startsWith(`${namespace}/`);

/**
 * Does `message` satisfy `rule`? `senderOwner` stands in for `rule.sender`
 * when that is a well-known name: messages carry the sender's unique name.
 */
export function matches(rule: MatchRule, message: Message, senderOwner: string | null | undefined): boolean {
  if (rule.type && TYPE_CODES[rule.type] !== message.type) return false;
  if (rule.sender !== undefined) {
    const expected = senderOwner === undefined ? rule.sender : senderOwner;
    if (expected === null || message.sender !== expected) return false;
  }
  if (rule.interface !== undefined && message.interface !== rule.interface) return false;
  if (rule.member !== undefined && message.member !== rule.member) return false;
  if (rule.path !== undefined && message.path !== rule.path) return false;
  if (rule.pathNamespace !== undefined && (message.path === undefined || !underNamespace(message.path, rule.pathNamespace))) {
    return false;
  }
  if (rule.destination !== undefined && message.destination !== rule.destination) return false;
  for (const [index, value] of Object.entries(rule.args ?? {})) {
    if (message.body[Number(index)] !== value) return false;
  }
  return true;
}

export interface Subscription {
  rule: MatchRule;
  handler: (message: Message) => void;
  /** The unique name currently owning `rule.sender`, when that is a well-known name; null if unowned. */
  senderOwner?: string | null;
}

export class SignalRouter {
  private readonly subscriptions = new Set<Subscription>();

  add(subscription: Subscription): () => void {
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  /** Hand `message` to every handler whose rule it satisfies; a throwing handler is logged, not fatal. */
  dispatch(message: Message): void {
    for (const subscription of [...this.subscriptions]) {
      if (!matches(subscription.rule, message, subscription.senderOwner)) continue;
      try {
        subscription.handler(message);
      } catch (error) {
        console.error("dashi-shell: a D-Bus signal handler threw:", error);
      }
    }
  }
}
