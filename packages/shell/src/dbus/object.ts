/**
 * Exported objects: what answers when a peer calls a path we own. The
 * registry maps paths to interface specs and turns an incoming method call
 * into a reply (or an error), including the standard interfaces every object
 * has: Introspectable, Peer, and Properties.
 */

import { readFileSync } from "node:fs";
import { DBusError, ERRORS } from "./errors.ts";
import { type CallContext, INTROSPECTABLE, type InterfaceSpec, introspectXml, type MethodSpec, PEER, PROPERTIES } from "./introspect.ts";
import type { Message } from "./message.ts";
import { isInterfaceName, isMemberName, isObjectPath } from "./names.ts";
import { parseSignature, parseSingle } from "./signature.ts";
import { Variant } from "./variant.ts";

export type Reply = { type: "return"; signature: string; body: unknown[] } | { type: "error"; name: string; message: string };

const MAX_ERROR_TEXT = 1024;

const fail = (name: string, message: string): Reply => ({ type: "error", name, message });
const ok = (signature = "", body: unknown[] = []): Reply => ({ type: "return", signature, body });

/** Reject a malformed spec at export time, where the developer can see it. */
function validate(path: string, interfaces: readonly InterfaceSpec[]): void {
  if (!isObjectPath(path)) throw new TypeError(`"${path}" is not an object path`);
  for (const spec of interfaces) {
    if (!isInterfaceName(spec.name)) throw new TypeError(`"${spec.name}" is not an interface name`);
    for (const [name, method] of Object.entries(spec.methods ?? {})) {
      if (!isMemberName(name)) throw new TypeError(`"${name}" is not a method name`);
      parseSignature(method.in ?? "");
      parseSignature(method.out ?? "");
    }
    for (const [name, signature] of Object.entries(spec.signals ?? {})) {
      if (!isMemberName(name)) throw new TypeError(`"${name}" is not a signal name`);
      parseSignature(signature);
    }
    for (const [name, property] of Object.entries(spec.properties ?? {})) {
      if (!isMemberName(name)) throw new TypeError(`"${name}" is not a property name`);
      parseSingle(property.type);
    }
  }
}

/** A record's own entry; member names come off the wire and must not reach `Object.prototype`. */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function errorReply(error: unknown): Reply {
  if (error instanceof DBusError) return fail(error.errorName, error.text.slice(0, MAX_ERROR_TEXT));
  const message = error instanceof Error ? error.message : String(error);
  return fail(ERRORS.failed, message.slice(0, MAX_ERROR_TEXT));
}

function machineId(): string {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{32}$/.test(id)) return id;
    } catch {
      // Try the next location.
    }
  }
  throw new DBusError(ERRORS.failed, "this machine has no id");
}

export class ObjectRegistry {
  private readonly objects = new Map<string, Map<string, InterfaceSpec>>();
  /** At most this many calls run at once; a peer can't queue unbounded work. */
  private inFlight = 0;

  constructor(private readonly maxInFlight = 64) {}

  add(path: string, interfaces: readonly InterfaceSpec[]): void {
    validate(path, interfaces);
    const existing = this.objects.get(path) ?? new Map<string, InterfaceSpec>();
    for (const spec of interfaces) existing.set(spec.name, spec);
    this.objects.set(path, existing);
  }

  remove(path: string): void {
    this.objects.delete(path);
  }

  interfacesAt(path: string): InterfaceSpec[] {
    return [...(this.objects.get(path)?.values() ?? [])];
  }

  /** The path segments one level below `path` that lead to exported objects. */
  private children(path: string): string[] {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set<string>();
    for (const other of this.objects.keys()) {
      if (other.length > prefix.length && other.startsWith(prefix)) names.add(other.slice(prefix.length).split("/")[0] as string);
    }
    return [...names].sort();
  }

  /** Answer a method call; never rejects. */
  async handle(call: Message): Promise<Reply> {
    if (this.inFlight >= this.maxInFlight) return fail(ERRORS.limitsExceeded, "too many calls in progress");
    this.inFlight++;
    try {
      return await this.dispatch(call);
    } catch (error) {
      return errorReply(error);
    } finally {
      this.inFlight--;
    }
  }

  private async dispatch(call: Message): Promise<Reply> {
    const path = call.path as string;
    const member = call.member as string;
    const iface = call.interface;
    const object = this.objects.get(path);
    const context: CallContext = { sender: call.sender, path, interface: iface, member };

    if (iface === INTROSPECTABLE && member === "Introspect") {
      const children = this.children(path);
      if (!object && children.length === 0) return fail(ERRORS.unknownObject, `no object at ${path}`);
      return ok("s", [introspectXml(object?.values() ?? [], children)]);
    }
    if (iface === PEER) {
      if (member === "Ping") return ok();
      if (member === "GetMachineId") return ok("s", [machineId()]);
    }
    if (!object) return fail(ERRORS.unknownObject, `no object at ${path}`);
    if (iface === PROPERTIES) return this.properties(object, member, call);

    const candidates = iface === undefined ? [...object.values()] : [object.get(iface)].filter((spec) => spec !== undefined);
    if (candidates.length === 0) return fail(ERRORS.unknownInterface, `${path} has no interface ${iface}`);
    const method = candidates.map((spec) => own(spec.methods, member)).find((found) => found !== undefined);
    if (!method) return fail(ERRORS.unknownMethod, `no method ${member} on ${iface ?? path}`);
    return this.invoke(method, call, context);
  }

  private async invoke(method: MethodSpec, call: Message, context: CallContext): Promise<Reply> {
    if (call.signature !== (method.in ?? "")) {
      return fail(ERRORS.invalidArgs, `${context.member} takes "${method.in ?? ""}", got "${call.signature}"`);
    }
    const result = await method.handler(call.body, context);
    const out = method.out ?? "";
    const count = parseSignature(out).length;
    if (count === 0) return ok();
    return ok(out, count === 1 ? [result] : (result as unknown[]));
  }

  private async properties(object: Map<string, InterfaceSpec>, member: string, call: Message): Promise<Reply> {
    const expected = { Get: "ss", GetAll: "s", Set: "ssv" }[member];
    if (expected === undefined) return fail(ERRORS.unknownMethod, `no method ${member} on ${PROPERTIES}`);
    if (call.signature !== expected) return fail(ERRORS.invalidArgs, `${member} takes "${expected}", got "${call.signature}"`);
    const [name, property, value] = call.body as [string, string, Variant];
    const spec = object.get(name);
    if (!spec) return fail(ERRORS.unknownInterface, `no interface ${name}`);
    const properties = spec.properties ?? {};
    if (member === "GetAll") {
      const all = new Map<string, Variant>();
      for (const [key, entry] of Object.entries(properties)) {
        if (entry.access !== "write" && entry.get) all.set(key, new Variant(entry.type, entry.get()));
      }
      return ok("a{sv}", [all]);
    }
    const entry = own(properties, property);
    if (!entry) return fail(ERRORS.unknownProperty, `no property ${property} on ${name}`);
    if (member === "Get") {
      if (entry.access === "write" || !entry.get) return fail(ERRORS.failed, `${property} cannot be read`);
      return ok("v", [new Variant(entry.type, entry.get())]);
    }
    if (entry.access === undefined || entry.access === "read" || !entry.set) {
      return fail(ERRORS.propertyReadOnly, `${property} is read-only`);
    }
    if (value.signature !== entry.type) return fail(ERRORS.invalidArgs, `${property} is "${entry.type}", got "${value.signature}"`);
    await entry.set(value.value);
    return ok();
  }
}
