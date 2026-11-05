/**
 * Reading an app's accessibility tree (AT-SPI) for what agents must not see
 * or may only fill: password fields, the focused field, and the addresses of
 * the web documents around it. Pure over `A11yNode`, so the walk is tested
 * with made-up trees; client.ts is the D-Bus side. A walk is bounded in
 * nodes and time, and skips what isn't showing.
 */

/** AT-SPI roles (AtspiRole) the walk cares about. */
export const ROLE = { FRAME: 23, PASSWORD_TEXT: 40, TEXT: 61, APPLICATION: 75, ENTRY: 79, DOCUMENT_WEB: 95 } as const;
/** AT-SPI states (AtspiStateType), as bit numbers in GetState's two words. */
export const STATE = { EDITABLE: 7, FOCUSED: 12, SHOWING: 25 } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface A11yNode {
  role(): Promise<number>;
  /** GetState's bit set: two 32-bit words. */
  states(): Promise<readonly number[]>;
  children(): Promise<A11yNode[]>;
  /** Where it is, in its window's coordinates (ATSPI_COORD_TYPE_WINDOW). */
  extents(): Promise<Rect | null>;
  /** A web document's address (Document's DocURL), else null. */
  url(): Promise<string | null>;
  /** Its parent, when the tree can be walked up (the focus is found by events, then its documents by its ancestors). */
  parent?(): Promise<A11yNode | null>;
}

/** How far up a field's documents are looked for. */
const MAX_DEPTH = 256;

/** The focused field from its node (found by a focus event): what it is, and the documents around it. */
export async function fieldAt(node: A11yNode): Promise<Focused | null> {
  const [role, states] = await Promise.all([node.role(), node.states()]);
  if (!hasState(states, STATE.FOCUSED)) return null;
  const documents: string[] = [];
  let current: A11yNode | null = node;
  for (let depth = 0; current?.parent && depth < MAX_DEPTH; depth++) {
    current = await current.parent().catch(() => null);
    if (!current) break;
    const up = await current.role().catch(() => -1);
    if (up === ROLE.DOCUMENT_WEB) documents.push((await current.url().catch(() => null)) ?? "");
    if (up === ROLE.APPLICATION) break;
  }
  return { kind: kindOf(role, states), rect: await node.extents().catch(() => null), documents };
}

function kindOf(role: number, states: readonly number[]): Focused["kind"] {
  if (role === ROLE.PASSWORD_TEXT) return "password";
  return hasState(states, STATE.EDITABLE) && (role === ROLE.ENTRY || role === ROLE.TEXT) ? "text" : "other";
}

export function hasState(states: readonly number[], state: number): boolean {
  const word = states[state >> 5] ?? 0;
  return ((word >>> (state & 31)) & 1) === 1;
}

export interface Limits {
  nodes: number;
  /** When to give up (Date.now() ms). */
  deadline: number;
}

export const limits = (ms = 400, nodes = 4000): Limits => ({ nodes, deadline: Date.now() + ms });

interface Visit {
  node: A11yNode;
  role: number;
  states: readonly number[];
  /** The web documents it is in, innermost first. */
  documents: readonly string[];
}

/** Every node, breadth first, until `visit` says stop or the limits are reached; a node that isn't showing keeps its children to itself. */
async function walk(root: A11yNode, limit: Limits, visit: (v: Visit) => boolean): Promise<boolean> {
  let queue: Array<{ node: A11yNode; documents: readonly string[] }> = [{ node: root, documents: [] }];
  let seen = 0;
  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { node, documents } of queue) {
      if (++seen > limit.nodes || Date.now() > limit.deadline) return false;
      let role: number;
      let states: readonly number[];
      try {
        [role, states] = await Promise.all([node.role(), node.states()]);
      } catch {
        continue;
      }
      let inside = documents;
      if (role === ROLE.DOCUMENT_WEB) {
        const url = await node.url().catch(() => null);
        inside = [url ?? "", ...documents];
      }
      if (visit({ node, role, states, documents: inside })) return true;
      const showing = role === ROLE.APPLICATION || hasState(states, STATE.SHOWING);
      if (!showing) continue;
      const children = await node.children().catch(() => []);
      for (const child of children) next.push({ node: child, documents: inside });
    }
    queue = next;
  }
  return true;
}

/** Where the password fields that are showing are, in their windows' coordinates. */
export async function passwordFields(root: A11yNode, limit: Limits = limits()): Promise<{ rects: Rect[]; complete: boolean }> {
  const found: A11yNode[] = [];
  const complete = await walk(root, limit, ({ node, role, states }) => {
    if (role === ROLE.PASSWORD_TEXT && hasState(states, STATE.SHOWING)) found.push(node);
    return false;
  });
  const rects = (await Promise.all(found.map((node) => node.extents().catch(() => null)))).filter((rect): rect is Rect => rect !== null);
  return { rects, complete };
}

export interface Focused {
  kind: "password" | "text" | "other";
  rect: Rect | null;
  /** The addresses of the web documents it is in, innermost first ("" when one has none). */
  documents: readonly string[];
}

/** The field that has the keyboard focus, if the walk finds it. */
export async function focusedField(root: A11yNode, limit: Limits = limits()): Promise<Focused | null> {
  let hit: Visit | null = null;
  await walk(root, limit, (visit) => {
    const leaf = visit.role !== ROLE.FRAME && visit.role !== ROLE.APPLICATION && visit.role !== ROLE.DOCUMENT_WEB;
    if (leaf && hasState(visit.states, STATE.FOCUSED)) {
      hit = visit;
      return true;
    }
    return false;
  });
  const found = hit as Visit | null;
  if (!found) return null;
  return { kind: kindOf(found.role, found.states), rect: await found.node.extents().catch(() => null), documents: found.documents };
}
