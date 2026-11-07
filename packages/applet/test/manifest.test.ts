import { expect, test } from "bun:test";
import {
  cannotDo,
  compareVersions,
  consentLines,
  dashiSatisfies,
  describeWhen,
  fits,
  manifestJson,
  parseManifest,
  parsePermission,
  permissionName,
  widens,
} from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

test("the spec's manifest is valid, and writes back as it was", () => {
  const manifest = parseManifest(ASUS);
  if ("error" in manifest) throw new Error(manifest.error);
  expect(manifest.permissions.map(permissionName)).toEqual(ASUS.permissions);
  expect(manifest.when).toEqual({ vendor: ["ASUSTeK COMPUTER INC."], laptop: true });
  expect(manifestJson(manifest).permissions).toEqual(ASUS.permissions);
  expect(manifest.screenshots).toEqual([]);
});

test("each field is checked, with a reason a person can act on", () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ id: "Weather" }, "reverse-DNS"],
    [{ id: "dev.example" }, "reverse-DNS"],
    [{ version: "1.0" }, "semantic version"],
    [{ dashi: "latest" }, "version range"],
    [{ entry: "../outside.ts" }, "inside the applet's folder"],
    [{ entry: "/etc/passwd.ts" }, "inside the applet's folder"],
    [{ entry: "src/.hidden/main.ts" }, "inside the applet's folder"],
    [{ entry: "src/main.py" }, "wrong kind of file"],
    [{ summary: "x".repeat(81) }, "longer than 80"],
    [{ name: "" }, "empty"],
    [{ author: { name: "A", url: "http://insecure" } }, "https"],
    [{ source: "git@github.com:a/b" }, "https"],
    [{ categories: ["games"] }, "one of"],
    [{ permissions: ["root"] }, "not a permission"],
    [{ permissions: ["network", "network"] }, "twice"],
    [{ permissions: ["hardware.smu"] }, "not a hardware permission"],
    [{ permissions: ["files.etc"] }, "not a folder"],
    [{ permissions: ["dbus.system:org.freedesktop.login1"] }, "can't ask for"],
    [{ permissions: ["dbus.session:dev.dashi.Shell"] }, "can't ask for"],
    [{ permissions: ["dbus.system:not a name"] }, "not a D-Bus name"],
    [{ when: { vendor: 3 } }, "text or a list"],
    [{ when: { cpu: "AMD" } }, "unknown field"],
    [{ when: { hardware: ["Fan Curves"] } }, "hardware name"],
    [{ screenshots: ["a.gif"] }, "wrong kind"],
    [{ extra: true }, "unknown field"],
  ];
  for (const [change, reason] of bad) {
    const result = parseManifest({ ...ASUS, ...change });
    expect(result).toHaveProperty("error");
    expect("error" in result ? result.error : "").toContain(reason);
  }
});

test("permissions in plain words, and what an applet can't do", () => {
  const names = ["hardware.power", "hardware.lighting", "notifications"];
  const permissions = names.map(parsePermission).filter((each): each is Exclude<typeof each, { error: string }> => !("error" in each));
  expect(consentLines(permissions)).toEqual([
    "Change the power mode, battery charge limit and processor boost",
    "Change the keyboard and lid lights",
    "Show notifications",
  ]);
  expect(cannotDo(permissions)).toBe("It can't read your files or use the network.");
  const net = parsePermission("network");
  const read = parsePermission("files.pictures:read");
  if ("error" in net || "error" in read) throw new Error("valid");
  expect(cannotDo([net])).toBe("It can't read your files.");
  expect(cannotDo([net, read])).toBeNull();
  expect(consentLines([read])).toEqual(["Read files in Pictures"]);
  expect(widens(names, permissions)).toBe(false);
  expect(widens(["notifications"], permissions)).toBe(true);
});

test("when: every condition holds, a list is any of, a trailing * is a prefix", () => {
  const g14 = { vendor: "ASUSTeK COMPUTER INC.", product: "ROG Zephyrus G14 GA403WR_GA403WR", laptop: true, hardware: ["platform-profile", "fan-curves"] };
  expect(fits(undefined, g14)).toBe(true);
  expect(fits({ vendor: ["ASUSTeK COMPUTER INC."] }, g14)).toBe(true);
  expect(fits({ vendor: ["LENOVO"] }, g14)).toBe(false);
  expect(fits({ product: ["ROG *", "TUF *"] }, g14)).toBe(true);
  expect(fits({ vendor: ["ASUSTeK COMPUTER INC."], laptop: false }, g14)).toBe(false);
  expect(fits({ hardware: ["fan-curves"] }, g14)).toBe(true);
  expect(fits({ hardware: ["slash"] }, g14)).toBe(false);
  // Unknown is not a match: a desktop without DMI doesn't fit an ASUS-only applet.
  expect(fits({ vendor: ["ASUSTeK COMPUTER INC."] }, {})).toBe(false);
  expect(describeWhen({ vendor: ["ASUSTeK COMPUTER INC."], laptop: true })).toBe("ASUSTeK COMPUTER INC. laptops");
  expect(describeWhen(undefined)).toBe("Any computer");
});

test("versions order as semver, and the dashi range is checked", () => {
  expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
  expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  expect(dashiSatisfies(">=0.4", "0.4.0")).toBe(true);
  expect(dashiSatisfies(">=0.4", "0.3.9")).toBe(false);
  expect(dashiSatisfies(">=0.4", "1.2.0")).toBe(true);
  expect(dashiSatisfies("^0.4", "0.5.0")).toBe(false);
  expect(dashiSatisfies("~0.4.1", "0.4.0")).toBe(false);
  expect(dashiSatisfies("0.4", "0.4.7")).toBe(true);
});
