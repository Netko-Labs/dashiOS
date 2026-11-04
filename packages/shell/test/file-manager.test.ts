import { expect, test } from "bun:test";
import { startFrom } from "../apps/files/main.tsx";
import { fileManagerInterface, filesRequests, MAX_WINDOWS, pathOfUri } from "../src/file-manager.ts";

test("file URIs become paths; other schemes, hosts, and junk do not", () => {
  expect(pathOfUri("file:///home/me/My%20Report.pdf")).toBe("/home/me/My Report.pdf");
  expect(pathOfUri("file://localhost/tmp/")).toBe("/tmp");
  expect(pathOfUri("file:///")).toBe("/");
  expect(pathOfUri("file://server/share/a")).toBeNull();
  expect(pathOfUri("https://example.org/a")).toBeNull();
  expect(pathOfUri("/home/me/a")).toBeNull();
  expect(pathOfUri("file:///a%00b")).toBeNull();
});

test("ShowItems: a window per folder with its items; folders and properties one each", () => {
  expect(filesRequests("items", ["file:///h/a.txt", "file:///h/b.txt", "file:///h/sub/c", "file:///h/a.txt"])).toEqual([
    ["/h/a.txt", "/h/b.txt"],
    ["/h/sub/c"],
  ]);
  expect(filesRequests("folders", ["file:///h", "file:///h/", "https://x"])).toEqual([["/h"]]);
  expect(filesRequests("properties", ["file:///h/a.txt"])).toEqual([["--info", "/h/a.txt"]]);
  const many = Array.from({ length: 20 }, (_, i) => `file:///d${i}`);
  expect(filesRequests("folders", many)).toHaveLength(MAX_WINDOWS);
});

test("the interface opens Files with the requests and the caller's token", async () => {
  const opened: Array<[readonly string[], string]> = [];
  const spec = fileManagerInterface((args, startup) => opened.push([args, startup]));
  await spec.methods?.ShowItems?.handler([["file:///h/a.txt"], "token-1"], { sender: ":1.5" } as never);
  expect(opened).toEqual([[["/h/a.txt"], "token-1"]]);
});

test("Files opens on the first item's folder with the others there selected too", () => {
  const isDirectory = (path: string) => (path === "/h" || path === "/h/sub" ? true : path === "/missing" ? null : false);
  expect(startFrom(["/h/a", "/h/b", "/h/sub/c", "/h/missing"], "/home", (p) => (p === "/h/missing" ? null : isDirectory(p)))).toEqual({
    location: { kind: "folder", path: "/h" },
    select: ["/h/a", "/h/b"],
  });
  expect(startFrom(["/h/sub"], "/home", isDirectory)).toEqual({ location: { kind: "folder", path: "/h/sub" }, select: [] });
  expect(startFrom([], "/home", isDirectory)).toEqual({ location: { kind: "folder", path: "/home" }, select: [] });
});
