/** The XML `org.freedesktop.DBus.Introspectable.Introspect` returns. */

import { splitSignature } from "./signature.ts";

export const INTROSPECTABLE = "org.freedesktop.DBus.Introspectable";
export const PROPERTIES = "org.freedesktop.DBus.Properties";
export const PEER = "org.freedesktop.DBus.Peer";

export interface MethodSpec {
  /** Argument signature; none when omitted. */
  in?: string;
  /** Result signature; none when omitted. */
  out?: string;
  /**
   * Handles a call. A method with one result type returns that value; with
   * several, an array of them; with none, nothing. Throw a `DBusError` to
   * reply with that error name.
   */
  handler(args: unknown[], call: CallContext): unknown;
}

export interface PropertySpec {
  /** The property's type, one complete type. */
  type: string;
  /** Defaults to `read`. */
  access?: "read" | "write" | "readwrite";
  get?(): unknown;
  set?(value: unknown): void | Promise<void>;
}

export interface InterfaceSpec {
  name: string;
  methods?: Record<string, MethodSpec>;
  /** Signal names to their argument signatures. */
  signals?: Record<string, string>;
  properties?: Record<string, PropertySpec>;
}

export interface CallContext {
  /** The caller's unique name. */
  sender: string | undefined;
  path: string;
  interface: string | undefined;
  member: string;
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const args = (signature: string | undefined, direction: "in" | "out" | null): string =>
  splitSignature(signature ?? "")
    .map((type) => `      <arg type="${type}"${direction ? ` direction="${direction}"` : ""}/>\n`)
    .join("");

const STANDARD = `  <interface name="${INTROSPECTABLE}">
    <method name="Introspect">
      <arg name="xml_data" type="s" direction="out"/>
    </method>
  </interface>
  <interface name="${PEER}">
    <method name="Ping"/>
    <method name="GetMachineId">
      <arg name="machine_uuid" type="s" direction="out"/>
    </method>
  </interface>
  <interface name="${PROPERTIES}">
    <method name="Get">
      <arg name="interface_name" type="s" direction="in"/>
      <arg name="property_name" type="s" direction="in"/>
      <arg name="value" type="v" direction="out"/>
    </method>
    <method name="GetAll">
      <arg name="interface_name" type="s" direction="in"/>
      <arg name="properties" type="a{sv}" direction="out"/>
    </method>
    <method name="Set">
      <arg name="interface_name" type="s" direction="in"/>
      <arg name="property_name" type="s" direction="in"/>
      <arg name="value" type="v" direction="in"/>
    </method>
    <signal name="PropertiesChanged">
      <arg name="interface_name" type="s"/>
      <arg name="changed_properties" type="a{sv}"/>
      <arg name="invalidated_properties" type="as"/>
    </signal>
  </interface>
`;

/** The introspection document for an object with these interfaces and child path segments. */
export function introspectXml(interfaces: Iterable<InterfaceSpec>, children: Iterable<string>): string {
  let xml =
    '<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"\n' +
    ' "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n<node>\n' +
    STANDARD;
  for (const spec of interfaces) {
    xml += `  <interface name="${escapeXml(spec.name)}">\n`;
    for (const [name, method] of Object.entries(spec.methods ?? {})) {
      xml += `    <method name="${escapeXml(name)}">\n${args(method.in, "in")}${args(method.out, "out")}    </method>\n`;
    }
    for (const [name, signature] of Object.entries(spec.signals ?? {})) {
      xml += `    <signal name="${escapeXml(name)}">\n${args(signature, null)}    </signal>\n`;
    }
    for (const [name, property] of Object.entries(spec.properties ?? {})) {
      xml += `    <property name="${escapeXml(name)}" type="${property.type}" access="${property.access ?? "read"}"/>\n`;
    }
    xml += "  </interface>\n";
  }
  for (const child of children) xml += `  <node name="${escapeXml(child)}"/>\n`;
  return `${xml}</node>\n`;
}
