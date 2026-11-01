/** The pieces of exporting an object that don't touch the socket. */

import { Flags, type Message, MessageType } from "./message.ts";
import { PROPERTIES } from "./introspect.ts";
import type { ObjectRegistry, Reply } from "./object.ts";
import type { ExportedObject, SignalSpec } from "./types.ts";
import { Variant } from "./variant.ts";

/** The handle `export()` returns: emit the object's signals, announce property changes, take it down. */
export function exportedObject(path: string, registry: ObjectRegistry, emit: (signal: SignalSpec) => void): ExportedObject {
  const find = (name: string) => registry.interfacesAt(path).find((spec) => spec.name === name);
  return {
    path,
    emit(interfaceName, signal, ...args) {
      const declared = find(interfaceName)?.signals;
      const signature = declared && Object.hasOwn(declared, signal) ? declared[signal] : undefined;
      if (signature === undefined) throw new TypeError(`${interfaceName} on ${path} declares no signal ${signal}`);
      emit({ path, interface: interfaceName, member: signal, signature, body: args });
    },
    propertiesChanged(interfaceName, names) {
      const properties = find(interfaceName)?.properties ?? {};
      const changed = new Map<string, Variant>();
      for (const name of names) {
        const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
        if (!property) throw new TypeError(`${interfaceName} on ${path} has no property ${name}`);
        if (property.get) changed.set(name, new Variant(property.type, property.get()));
      }
      emit({ path, interface: PROPERTIES, member: "PropertiesChanged", signature: "sa{sv}as", body: [interfaceName, changed, []] });
    },
    unexport: () => registry.remove(path),
  };
}

/** The message that answers `call` with `reply`. */
export function replyMessage(call: Message, reply: Reply, serial: number): Message {
  const common = { flags: Flags.NoReplyExpected, serial, replySerial: call.serial };
  const to = call.sender === undefined ? {} : { destination: call.sender };
  return reply.type === "return"
    ? { ...common, ...to, type: MessageType.MethodReturn, signature: reply.signature, body: reply.body }
    : { ...common, ...to, type: MessageType.Error, errorName: reply.name, signature: "s", body: [reply.message] };
}
