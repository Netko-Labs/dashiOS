/**
 * react-reconciler's host config for launcher views (mutation mode): an
 * extension's components (components.tsx) render the elements of
 * view/elements.ts as host instances, and each commit hands the container to
 * its view (view-root.ts), which turns the instances into a tree and sends
 * what changed. Nothing here draws: the launcher does, from the tree.
 */

import { createContext } from "react";
import type ReactReconciler from "react-reconciler";
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants";
import { type ElementType, isElementType } from "../../view/elements.ts";

/** One element as the extension rendered it: its own props (callbacks included) and children. */
export interface Instance {
  type: ElementType;
  /** Its node id on the wire: stable while it is mounted. */
  id: string;
  props: Record<string, unknown>;
  children: Instance[];
  parent: Instance | Container | null;
}

/** What a view's React root renders into. */
export interface Container {
  children: Instance[];
  /** A fresh node id ("n12"). */
  nextId(): string;
  /** A commit ended: send what changed. */
  committed(): void;
}

type HostContext = Record<string, never>;
const HOST_CONTEXT: HostContext = {};

export type HostConfig = ReactReconciler.HostConfig<
  string,
  Record<string, unknown>,
  Container,
  Instance,
  never,
  never,
  never,
  never,
  Instance,
  HostContext,
  never,
  ReturnType<typeof setTimeout>,
  -1,
  null
>;

let priority: number = NoEventPriority;

function detach(list: Instance[], child: Instance): void {
  const at = list.indexOf(child);
  if (at >= 0) list.splice(at, 1);
}

function insert(list: Instance[], child: Instance, before: Instance): void {
  detach(list, child);
  const at = list.indexOf(before);
  list.splice(at < 0 ? list.length : at, 0, child);
}

export const hostConfig: HostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,

  createInstance(type, props, container) {
    if (!isElementType(type)) throw new Error(`<${type}> is not an element of a launcher view`);
    return { type, id: container.nextId(), props, children: [], parent: null };
  },
  createTextInstance(text) {
    throw new Error(`Words in a launcher view go in a prop (title, text, markdown), not between tags: “${text.slice(0, 40)}”`);
  },
  appendInitialChild(parent, child) {
    parent.children.push(child);
    child.parent = parent;
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  resetTextContent() {},
  getRootHostContext: () => HOST_CONTEXT,
  getChildHostContext: (context) => context,
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit(container) {
    container.committed();
  },
  preparePortalMount() {},
  scheduleTimeout: (fn, delay) => setTimeout(fn, delay),
  cancelTimeout: (id) => clearTimeout(id),
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  detachDeletedInstance() {},

  appendChild(parent, child) {
    detach(parent.children, child);
    parent.children.push(child);
    child.parent = parent;
  },
  appendChildToContainer(container, child) {
    detach(container.children, child);
    container.children.push(child);
    child.parent = container;
  },
  insertBefore(parent, child, before) {
    insert(parent.children, child, before);
    child.parent = parent;
  },
  insertInContainerBefore(container, child, before) {
    insert(container.children, child, before);
    child.parent = container;
  },
  removeChild(parent, child) {
    detach(parent.children, child);
    child.parent = null;
  },
  removeChildFromContainer(container, child) {
    detach(container.children, child);
    child.parent = null;
  },
  commitTextUpdate() {},
  commitUpdate(instance, _type, _prev, next) {
    // The container's commit (resetAfterCommit) sends what changed.
    instance.props = next;
  },
  clearContainer(container) {
    container.children.length = 0;
  },

  NotPendingTransition: null,
  // React's own context object; @types/react-reconciler types it as its internal shape, which React's public
  // type doesn't name (mirin's host config does the same). Nothing from outside is cast here.
  HostTransitionContext: createContext<null>(null) as never,
  setCurrentUpdatePriority(next) {
    priority = next;
  },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
};
