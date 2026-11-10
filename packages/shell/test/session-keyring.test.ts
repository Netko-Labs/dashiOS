import { expect, test } from "bun:test";
import { BRIDGE_UNIT, type KeyringDeps, startKeyring, VAULT_SOCKET } from "../src/session/lib/keyring.ts";

function deps(options: { vault: boolean; bridgeFails?: boolean; gnome?: boolean }) {
  const ran: string[][] = [];
  const logs: string[] = [];
  const value: KeyringDeps = {
    which: (program) => (program === "systemctl" || (program === "gnome-keyring-daemon" && options.gnome) ? `/usr/bin/${program}` : null),
    exists: (path) => options.vault && path === VAULT_SOCKET,
    async run(command) {
      ran.push([...command]);
      if (command[0] === "systemctl") return { stdout: "", failure: options.bridgeFails ? "exit 1" : null };
      return { stdout: "GNOME_KEYRING_CONTROL=/run/user/1000/keyring\n", failure: null };
    },
    log: (message) => logs.push(message),
  };
  return { value, ran, logs };
}

test("Dashi's vault serves the Secret Service where it is installed, and gnome-keyring isn't started", async () => {
  const { value, ran } = deps({ vault: true, gnome: true });
  expect(await startKeyring(value)).toEqual({});
  expect(ran).toEqual([["systemctl", "--user", "start", BRIDGE_UNIT]]);
});

test("without the vault, or if its bridge fails, gnome-keyring does as before", async () => {
  for (const options of [
    { vault: false, gnome: true },
    { vault: true, bridgeFails: true, gnome: true },
  ]) {
    const { value, ran } = deps(options);
    expect(await startKeyring(value)).toEqual({ GNOME_KEYRING_CONTROL: "/run/user/1000/keyring" });
    expect(ran.at(-1)?.[0]).toBe("gnome-keyring-daemon");
  }
});
