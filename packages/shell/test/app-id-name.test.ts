import { expect, test } from "bun:test";
import { appFor } from "../src/apps.ts";
import { appIdName } from "../src/shared/app-entries/index.ts";

test("a reverse-DNS app id is named by its last part", () => {
  expect(appIdName("org.kde.konsole", "~ : bash")).toBe("Konsole");
  expect(appIdName("foot", "~")).toBe("Foot");
});

test("an app id ending in a version is named as it is, never by the version (the bar read “0”)", () => {
  expect(appIdName("gst-launch-1.0", "")).toBe("gst-launch-1.0");
  expect(appIdName("python3.12", "plot")).toBe("python3.12");
  expect(appFor([], { appId: "gst-launch-1.0", title: "" }).name).toBe("gst-launch-1.0");
});

test("no app id: the window's title, else Untitled", () => {
  expect(appIdName("", "Report")).toBe("Report");
  expect(appIdName("", "")).toBe("Untitled");
});
