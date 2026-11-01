/**
 * The name grammars of the D-Bus specification. Everything that arrives from
 * a peer is checked against these before it is used as a key or a path.
 */

const MAX_NAME = 255;

const OBJECT_PATH = /^(?:\/|(?:\/[A-Za-z0-9_]+)+)$/;
const ELEMENT = "[A-Za-z_][A-Za-z0-9_]*";
const INTERFACE = new RegExp(`^${ELEMENT}(?:\\.${ELEMENT})+$`);
const MEMBER = new RegExp(`^${ELEMENT}$`);
const BUS_ELEMENT = "[A-Za-z0-9_-]+";
const WELL_KNOWN = new RegExp(`^[A-Za-z_-][A-Za-z0-9_-]*(?:\\.${BUS_ELEMENT})+$`);
const UNIQUE = new RegExp(`^:${BUS_ELEMENT}(?:\\.${BUS_ELEMENT})+$`);

export const isObjectPath = (value: string): boolean => OBJECT_PATH.test(value);

export const isInterfaceName = (value: string): boolean => value.length <= MAX_NAME && INTERFACE.test(value);

export const isMemberName = (value: string): boolean => value.length <= MAX_NAME && MEMBER.test(value);

/** Error names follow the interface grammar. */
export const isErrorName = isInterfaceName;

export const isUniqueName = (value: string): boolean => value.length <= MAX_NAME && UNIQUE.test(value);

export const isWellKnownName = (value: string): boolean => value.length <= MAX_NAME && WELL_KNOWN.test(value);

export const isBusName = (value: string): boolean => isUniqueName(value) || isWellKnownName(value);
