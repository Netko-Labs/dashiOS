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
export const STATE = { DEFUNCT: 6, EDITABLE: 7, FOCUSED: 12, SHOWING: 25 } as const;

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
  /** Ask for its attributes (what wakes Chromium's tree: Atspi.wake). */
  attributes?(): Promise<void>;
}

/** How far up a field's documents are looked for. */
const MAX_DEPTH = 256;

/** The focused field from its node (found by a focus event): what it is, and the documents around it. */
export async function fieldAt(node: A11yNode): Promise<Focused | null> {
  const [role, states] = await Promise.all([node.role(), node.states()]);
  if (!hasState(states, STATE.FOCUSED)) return null;
  const documents: string[] = [];
  let page: A11yNode | null = null;
  let current: A11yNode | null = node;
  for (let depth = 0; current?.parent && depth < MAX_DEPTH; depth++) {
    current = await current.parent().catch(() => null);
    if (!current) break;
    const up = await current.role().catch(() => -1);
    if (up === ROLE.DOCUMENT_WEB) {
      documents.push((await current.url().catch(() => null)) ?? "");
      page = current;
    }
    if (up === ROLE.APPLICATION) break;
  }
  return { kind: kindOf(role, states), ...(await placed(node, page)), documents, again: () => placeAgain(node, page) };
}

/** A node's extents, with its page's (the outermost web document around it) to place it by. */
async function placed(node: A11yNode, page: A11yNode | null): Promise<Placed> {
  const [rect, pageRect] = await Promise.all([extentsOf(node), page ? extentsOf(page) : null]);
  return { rect, page: pageRect };
}

/** Firefox answers a node's first GetExtents with nothing and the next with its place (measured in the VM). */
export const EXTENTS_RETRY_MS = 100;

async function extentsOf(node: A11yNode): Promise<Rect | null> {
  const first = await node.extents().catch(() => null);
  if (first) return first;
  await Bun.sleep(EXTENTS_RETRY_MS);
  return node.extents().catch(() => null);
}

/** Where something is, as the app says, and where its page is in the same units (null outside a web page). */
export interface Placed {
  rect: Rect | null;
  page: Rect | null;
  /** Where it is now: gone once its page has (the app forgot the node), hidden while it isn't showing. */
  again?(): Promise<Placed | "gone" | "hidden">;
}

/** A node placed again, for a field that must stay blank where it moves (scrolling) and no longer once its page is gone. */
export async function placeAgain(node: A11yNode, page: A11yNode | null): Promise<Placed | "gone" | "hidden"> {
  let states: readonly number[];
  try {
    states = await node.states();
  } catch {
    return "gone";
  }
  if (hasState(states, STATE.DEFUNCT)) return "gone";
  if (!hasState(states, STATE.SHOWING)) return "hidden";
  return placed(node, page);
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
  /** The outermost of them, the page. */
  page: A11yNode | null;
}

/** Every node, breadth first, until `visit` says stop or the limits are reached; a node that isn't showing keeps its children to itself. */
async function walk(root: A11yNode, limit: Limits, visit: (v: Visit) => boolean): Promise<boolean> {
  let queue: Array<{ node: A11yNode; documents: readonly string[]; page: A11yNode | null }> = [{ node: root, documents: [], page: null }];
  let seen = 0;
  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { node, documents, page: outer } of queue) {
      if (++seen > limit.nodes || Date.now() > limit.deadline) return false;
      let role: number;
      let states: readonly number[];
      try {
        [role, states] = await Promise.all([node.role(), node.states()]);
      } catch {
        continue;
      }
      let inside = documents;
      let page = outer;
      if (role === ROLE.DOCUMENT_WEB) {
        const url = await node.url().catch(() => null);
        inside = [url ?? "", ...documents];
        page ??= node;
      }
      if (visit({ node, role, states, documents: inside, page })) return true;
      const showing = role === ROLE.APPLICATION || hasState(states, STATE.SHOWING);
      if (!showing) continue;
      const children = await node.children().catch(() => []);
      for (const child of children) next.push({ node: child, documents: inside, page });
    }
    queue = next;
  }
  return true;
}

/** The web documents that are showing. */
export async function documents(root: A11yNode, limit: Limits = limits()): Promise<A11yNode[]> {
  const found: A11yNode[] = [];
  await walk(root, limit, ({ node, role }) => {
    if (role === ROLE.DOCUMENT_WEB) found.push(node);
    return false;
  });
  return found;
}

/** Where the password fields that are showing are, as the app says (place them with toWindow). */
export async function passwordFields(
  root: A11yNode,
  limit: Limits = limits(),
): Promise<{ rects: Array<{ rect: Rect; page: Rect | null }>; complete: boolean }> {
  const found: Array<{ node: A11yNode; page: A11yNode | null }> = [];
  const complete = await walk(root, limit, ({ node, role, states, page }) => {
    if (role === ROLE.PASSWORD_TEXT && hasState(states, STATE.SHOWING)) found.push({ node, page });
    return false;
  });
  const all = await Promise.all(found.map(({ node, page }) => placed(node, page)));
  const rects = all.flatMap(({ rect, page }) => (rect ? [{ rect, page }] : []));
  return { rects, complete };
}

/**
 * An app's rect in its window's content coordinates (points). Apps report
 * AT-SPI's window coordinates their own way: Chromium on Wayland in device
 * pixels, from a window origin it guesses (measured in the VM: off by its
 * frame). So a web field is placed by its page instead: the page fills the
 * window's content below the toolbar, borders equal at left, right and
 * bottom, and their ratio is the app's scale. Outside a web page the rect is
 * taken as it comes.
 */
export function toWindow(rect: Rect, page: Rect | null, window: { width: number; height: number }): Rect {
  if (!page || page.width <= 0 || window.width <= 0) return rect;
  const scale = Math.min(4, Math.max(1, Math.round((page.width / window.width) * 4) / 4));
  const border = Math.max(0, (window.width - page.width / scale) / 2);
  const top = window.height - page.height / scale - border;
  return {
    x: border + (rect.x - page.x) / scale,
    y: top + (rect.y - page.y) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

export interface Focused extends Placed {
  kind: "password" | "text" | "other";
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
  const { node, page } = found;
  return { kind: kindOf(found.role, found.states), ...(await placed(node, page)), documents: found.documents, again: () => placeAgain(node, page) };
}
