/**
 * A picture the host cannot draw (decisions.md D133): the host says so
 * (`imageerror`), and what stands in is drawn: the generic icon for an app's
 * icon, the initials for an account picture, whatever `fallback` is.
 */

import { expect, test } from "bun:test";
import { Avatar, Picture } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render, Text } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { AppIcon, iconPath, resolveIcon } from "../src/shared/apps/index.ts";
import { FORMATS } from "../src/shared/files/index.ts";
import { settle } from "./support/time.ts";

interface Node {
  type?: string;
  props?: { id?: string; src?: string; onError?: boolean };
  children?: (Node | string)[];
}

function find(node: Node | string, type: string): Node[] {
  if (typeof node === "string") return [];
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((child) => find(child, type))];
}

/** `element` drawn for a host that says when an image fails (or one from before that). */
async function mount(element: ReactElement, tells = true) {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const root = render(element, transport);
  await settle();
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  await emit({ type: "protocol", nodeId: "root", patches: 0, ...(tells ? { imageError: true } : {}) });
  const tree = (): Node => JSON.parse(trees.at(-1) ?? "{}");
  const images = (): Node[] => find(tree(), "image");
  /** The host could not draw the one image on screen. */
  const fails = (error = "not an image the host can decode"): Promise<void> => emit({ type: "imageerror", nodeId: images()[0]?.props?.id ?? "", error });
  return { root, tree, images, fails, text: () => JSON.stringify(tree()) };
}

test("an icon by path is handed over as it is, and the generic icon stands in when the host cannot draw it", async () => {
  // No file is read first: a TIFF, an XPM, a path that is gone are all the host's to refuse.
  expect(resolveIcon("/opt/app/icon.xpm")).toBe("/opt/app/icon.xpm");
  const drawn = await mount(<AppIcon source="/opt/app/icon.xpm" style={{ width: 22, height: 22 }} />);
  expect(drawn.images()[0]?.props).toMatchObject({ src: "/opt/app/icon.xpm", onError: true });
  await drawn.fails();
  expect(drawn.images().map((image) => image.props?.src)).toEqual([iconPath("generic")]);
  drawn.root.unmount();
});

test("an account picture the host cannot draw is the person's initial", async () => {
  const drawn = await mount(<Avatar name="alex" picture="/var/lib/AccountsService/icons/alexk" />);
  expect(drawn.images()).toHaveLength(1);
  await drawn.fails("no such file");
  expect(drawn.images()).toHaveLength(0);
  expect(drawn.text()).toContain('"A"');
  drawn.root.unmount();
});

test("another source is tried afresh; a host from before `imageError` is told of no handler", async () => {
  const drawn = await mount(<Picture source="/a.tiff" fallback={<Text>none</Text>} />);
  await drawn.fails();
  expect(drawn.text()).toContain("none");
  drawn.root.unmount();
  const old = await mount(<Picture source="/a.tiff" fallback={<Text>none</Text>} />, false);
  expect(old.images()[0]?.props?.onError).toBeUndefined();
  old.root.unmount();
});

test("Preview converts a TIFF as it does a HEIC: the host does not decode it", () => {
  expect(FORMATS.tiff.native).toBe(false);
  expect(FORMATS.tiff.coder).toBe("tiff");
});
