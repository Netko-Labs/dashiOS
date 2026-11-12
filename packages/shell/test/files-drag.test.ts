import { expect, test } from "bun:test";
import { dragPaths, dropChoice } from "../src/shared/file-browser/lib/drag.ts";

const none = { ctrl: false, alt: false, shift: false };
const oneDisk = () => true;
const twoDisks = (a: string, b: string) => a.startsWith("/media") === b.startsWith("/media");

test("a drag carries the selection when the pressed item is in it, else the item alone", () => {
  expect(dragPaths("/h/a", ["/h/a", "/h/b"])).toEqual(["/h/a", "/h/b"]);
  expect(dragPaths("/h/c", ["/h/a", "/h/b"])).toEqual(["/h/c"]);
});

test("a drop moves on one disk, copies across disks; ⌥ or Ctrl copies, ⇧ moves", () => {
  expect(dropChoice(["/h/a.txt"], "/h/docs", none, oneDisk)).toEqual({ mode: "move", paths: ["/h/a.txt"] });
  expect(dropChoice(["/h/a.txt"], "/media/usb", none, twoDisks)).toEqual({ mode: "copy", paths: ["/h/a.txt"] });
  expect(dropChoice(["/h/a.txt"], "/h/docs", { ...none, alt: true }, oneDisk)?.mode).toBe("copy");
  expect(dropChoice(["/h/a.txt"], "/h/docs", { ...none, ctrl: true }, oneDisk)?.mode).toBe("copy");
  expect(dropChoice(["/h/a.txt"], "/media/usb", { ...none, shift: true }, twoDisks)?.mode).toBe("move");
});

test("nothing happens dropping where the items already are, or a folder inside itself", () => {
  expect(dropChoice(["/h/docs/a"], "/h/docs", none, oneDisk)).toBeNull();
  expect(dropChoice(["/h/docs/a", "/h/b"], "/h/docs", none, oneDisk)).toEqual({ mode: "move", paths: ["/h/b"] });
  expect(dropChoice(["/h/docs"], "/h/docs/sub", none, oneDisk)).toBeNull();
  expect(dropChoice(["/h/docs"], "/h/docs", none, oneDisk)).toBeNull();
  expect(dropChoice(["/h/doc"], "/h/docs", none, oneDisk)).toEqual({ mode: "move", paths: ["/h/doc"] });
  // A copy into the same folder is a copy beside the original.
  expect(dropChoice(["/h/docs/a"], "/h/docs", { ...none, alt: true }, oneDisk)).toEqual({ mode: "copy", paths: ["/h/docs/a"] });
  expect(dropChoice([], "/h", none, oneDisk)).toBeNull();
});
