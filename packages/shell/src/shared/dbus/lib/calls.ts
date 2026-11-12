/** The messages a connection sends: a method call and a signal, as `Message`s ready to encode. */

import { Flags, type Message, MessageType } from "../message.ts";
import type { CallSpec, SignalSpec } from "../types.ts";

export function callMessage(spec: CallSpec, serial: number): Message {
  const message: Message = {
    type: MessageType.MethodCall,
    flags: (spec.noReply ? Flags.NoReplyExpected : 0) | (spec.interactive ? Flags.AllowInteractiveAuthorization : 0),
    serial,
    path: spec.path,
    member: spec.member,
    signature: spec.signature ?? "",
    body: [...(spec.body ?? [])],
  };
  if (spec.interface !== undefined) message.interface = spec.interface;
  if (spec.destination !== undefined) message.destination = spec.destination;
  return message;
}

export function signalMessage(spec: SignalSpec, serial: number): Message {
  const message: Message = {
    type: MessageType.Signal,
    flags: Flags.NoReplyExpected,
    serial,
    path: spec.path,
    interface: spec.interface,
    member: spec.member,
    signature: spec.signature ?? "",
    body: [...(spec.body ?? [])],
  };
  if (spec.destination !== undefined) message.destination = spec.destination;
  return message;
}
