import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VM = join(import.meta.dir, "../../../vm/vm");
const dir = mkdtempSync(join(tmpdir(), "dashi-vm-checkout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** vm/vm with a stand-in `ssh` that only writes down what it was asked to run, from a checkout outside the VM's share. */
async function vm(...args: string[]): Promise<{ code: number; asked: string; said: string }> {
  const asked = join(dir, "asked");
  writeFileSync(asked, "");
  writeFileSync(join(dir, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${asked}'\n`);
  chmodSync(join(dir, "ssh"), 0o755);
  const child = Bun.spawn([VM, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DASHI_VM_PASSWORD: "test-dashi", DASHI_VM_SHARE: join(dir, "elsewhere") },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, said] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, asked: readFileSync(asked, "utf8"), said };
}

test("the checkout's session is turned off from any checkout; turning it on needs one the VM can see", async () => {
  const off = await vm("checkout-session", "off");
  expect(off.code).toBe(0);
  expect(off.asked).toContain("rm -f /usr/share/wayland-sessions/dashi-checkout.desktop");
  expect((await vm("checkout-greeter", "off")).asked).toContain("systemctl restart sddm");
  const on = await vm("checkout-session", "on");
  expect(on.code).toBe(1);
  expect(on.said).toContain("outside the folder the VM shares");
  expect(on.asked).toBe("");
});
