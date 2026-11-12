import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helperCommand, installArgs, isLiveBoot, parseEvent } from "../apps/installer/lib/helper.ts";
import { type Account, accountProblem, advance, nextPage, overall, previousPage, START, suggestHostname, suggestUser } from "../apps/installer/lib/model.ts";
import { hasNvidia, parseDisks, sizeLabel } from "../apps/installer/lib/probe.ts";
import { liveInstaller } from "../src/setup/lib/live.ts";

const LSBLK = {
  blockdevices: [
    { path: "/dev/nvme0n1", size: 1_000_204_886_016, model: "Samsung SSD 990 PRO 1TB", tran: "nvme", rm: false, ro: false, type: "disk" },
    { path: "/dev/sda", size: 30_752_000_000, model: null, tran: "usb", rm: true, ro: false, type: "disk" },
    { path: "/dev/sdb", size: 8_000_000_000, model: "Tiny", tran: "usb", rm: true, ro: false, type: "disk" },
    { path: "/dev/sr0", size: 1_073_741_312, model: "QEMU DVD-ROM", tran: "sata", rm: true, ro: false, type: "rom" },
    { path: "/dev/zram0", size: 8_589_934_592, model: null, tran: null, rm: false, ro: false, type: "disk" },
    { path: "/dev/vdc", size: 64_424_509_440, model: null, tran: "virtio", rm: false, ro: true, type: "disk" },
  ],
};

test("disks: whole and writable, the live USB drive and small ones unavailable", () => {
  const disks = parseDisks(LSBLK, new Map([["/dev/sda", "The Dashi USB drive this computer started from."]]));
  expect(disks.map((disk) => disk.path)).toEqual(["/dev/nvme0n1", "/dev/sda", "/dev/sdb"]);
  expect(disks[0]).toEqual({ path: "/dev/nvme0n1", name: "Samsung SSD 990 PRO 1TB", bytes: 1_000_204_886_016, transport: "nvme", removable: false });
  expect(disks[1]?.name).toBe("USB drive");
  expect(disks[1]?.unavailable).toContain("USB drive");
  expect(disks[2]?.unavailable).toContain("Too small");
  expect(parseDisks(null)).toEqual([]);
  expect(sizeLabel(1_000_204_886_016)).toBe("1 TB");
  expect(sizeLabel(64_424_509_440)).toBe("64.4 GB");
});

test("an NVIDIA display controller is found by its PCI vendor and class", () => {
  const root = mkdtempSync(join(tmpdir(), "pci-"));
  const device = (name: string, vendor: string, klass: string) => {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "vendor"), `${vendor}\n`);
    writeFileSync(join(root, name, "class"), `${klass}\n`);
  };
  device("0000:00:01.0", "0x1002", "0x030000");
  device("0000:01:00.1", "0x10de", "0x040300");
  expect(hasNvidia(root)).toBe(false);
  device("0000:01:00.0", "0x10de", "0x030200");
  expect(hasNvidia(root)).toBe(true);
  expect(hasNvidia(join(root, "missing"))).toBe(false);
});

test("dashi-install's events, and nothing else", () => {
  expect(parseEvent('{"event":"step","step":"copy"}')).toEqual({ event: "step", step: "copy" });
  expect(parseEvent('{"event":"progress","step":"copy","fraction":1.7}')).toEqual({ event: "progress", step: "copy", fraction: 1 });
  expect(parseEvent('{"event":"failed","step":"bootloader","message":"no shim"}')).toEqual({ event: "failed", step: "bootloader", message: "no shim" });
  expect(parseEvent('{"event":"finished","ok":true}')).toEqual({ event: "finished", ok: true });
  expect(parseEvent('{"event":"step","step":"format the world"}')).toBeNull();
  expect(parseEvent("mkfs.fat 4.2")).toBeNull();
});

test("the command: pkexec and the real helper on the live image, a dry run elsewhere; never the password", () => {
  const choice = { disk: "/dev/nvme0n1", user: "juan", fullName: "Juan Castañeda", hostname: "juan-dashi", nvidia: true };
  expect(installArgs(choice)).toEqual([
    "--disk",
    "/dev/nvme0n1",
    "--user",
    "juan",
    "--full-name",
    "Juan Castañeda",
    "--hostname",
    "juan-dashi",
    "--nvidia",
    "yes",
    "--kernel",
    "auto",
  ]);
  const real = helperCommand(
    choice,
    false,
    () => true,
    () => "/usr/bin/pkexec",
  );
  expect(real?.slice(0, 2)).toEqual(["/usr/bin/pkexec", "/usr/libexec/dashi/dashi-install"]);
  expect(
    helperCommand(
      choice,
      false,
      () => true,
      () => null,
    ),
  ).toBeNull();
  const dry = helperCommand(choice, true, () => true);
  expect(dry?.[1]).toBe("--dry-run");
  expect(isLiveBoot("BOOT_IMAGE=/images/pxeboot/vmlinuz root=live:CDLABEL=Dashi-0.3.0 rd.live.image quiet")).toBe(true);
  expect(isLiveBoot("root=UUID=abc ro rootflags=subvol=root")).toBe(false);
});

test("the live image opens Dashi's Installer, Anaconda only without it", () => {
  const live = "rd.live.image quiet";
  expect(
    liveInstaller(
      live,
      () => "/usr/bin/liveinst",
      () => true,
    ),
  ).toBe("/usr/libexec/dashi/dashi-installer");
  expect(
    liveInstaller(
      live,
      () => "/usr/bin/liveinst",
      () => false,
    ),
  ).toBe("/usr/bin/liveinst");
  expect(
    liveInstaller(
      "root=UUID=abc",
      () => "/usr/bin/liveinst",
      () => true,
    ),
  ).toBeNull();
});

test("an account: names suggested from the full name, and what it needs", () => {
  expect(suggestUser("Juan Castañeda")).toBe("juan");
  expect(suggestUser("  Ömer  ")).toBe("omer");
  expect(suggestUser("2pac Shakur")).toBe("pac");
  expect(suggestHostname("juan")).toBe("juan-dashi");
  expect(suggestHostname("")).toBe("dashi");
  const ready: Account = { fullName: "Juan", user: "juan", password: "secret1", confirm: "secret1", hostname: "juan-dashi" };
  expect(accountProblem(ready)).toBeNull();
  expect(accountProblem({ ...ready, fullName: " " })).toContain("name");
  expect(accountProblem({ ...ready, user: "Juan" })).toContain("lowercase");
  expect(accountProblem({ ...ready, user: "root" })).toContain("taken");
  expect(accountProblem({ ...ready, password: "abc", confirm: "abc" })).toContain("6");
  expect(accountProblem({ ...ready, confirm: "secret2" })).toContain("match");
  expect(accountProblem({ ...ready, hostname: "my pc" })).toContain("computer");
});

test("pages in order, and the install's progress from its events", () => {
  expect(nextPage("welcome")).toBe("disk");
  expect(nextPage("confirm")).toBe("installing");
  expect(previousPage("disk")).toBe("welcome");
  expect(previousPage("welcome")).toBe("welcome");
  let progress = START;
  for (const event of [
    { event: "step", step: "check" },
    { event: "step", step: "partition" },
    { event: "step", step: "copy" },
    { event: "progress", step: "copy", fraction: 0.5 },
  ] as const)
    progress = advance(progress, event);
  expect(progress.done).toEqual(["check", "partition"]);
  expect(progress.fraction).toBe(0.5);
  expect(overall(progress)).toBeCloseTo((1 + 3 + 35) / 100);
  const failed = advance(progress, { event: "failed", step: "copy", message: "rsync" });
  expect(advance(failed, { event: "finished", ok: false })).toMatchObject({ ok: false, failed: { step: "copy" }, done: ["check", "partition"] });
  const finished = advance(advance(progress, { event: "step", step: "finish" }), { event: "finished", ok: true });
  expect(finished.done).toContain("finish");
  expect(finished.ok).toBe(true);
});
