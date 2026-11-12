/**
 * The installer's wizard: the page it is on, what the machine reported
 * (probe.ts), the disk, the account and the NVIDIA choice the person made, and
 * the install itself (helper.ts). The password leaves the form as soon as it
 * is on its way. model.ts holds the rules; the pages are pages.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { type InstallChoice, isDryRun, runInstall } from "./helper.ts";
import { type Account, advance, type Page, type Progress, START, suggestHostname, suggestUser } from "./model.ts";
import { type Disk, type Machine, probeMachine } from "./probe.ts";

export interface Wizard {
  page: Page;
  setPage(page: Page): void;
  machine: Machine | null;
  disk: string | null;
  setDisk(path: string): void;
  /** The disk the person chose, from the machine's list. */
  chosen: Disk | null;
  account: Account;
  /** Edits the account's fields as typed (the password and its confirmation among them). */
  edit(patch: Partial<Account>): void;
  setName(fullName: string): void;
  /** Typed by hand, the account name stops following the full name. */
  setUser(user: string): void;
  /** Typed by hand, the computer's name stops following the account name. */
  setHostname(hostname: string): void;
  nvidia: boolean;
  setNvidia(on: boolean): void;
  progress: Progress;
  dryRun: boolean;
  install(): void;
}

interface InstallOps {
  setPage(page: Page): void;
  setProgress(progress: Progress): void;
  clearPassword(): void;
}

/** Runs the install for the chosen disk, and says where it ended: "done" or "failed". */
function startInstall(chosen: Disk, account: Account, nvidia: boolean, dryRun: boolean, ops: InstallOps): void {
  const choice: InstallChoice = { disk: chosen.path, user: account.user, fullName: account.fullName.trim(), hostname: account.hostname, nvidia };
  const password = account.password;
  // The password leaves the form as soon as it is on its way.
  ops.clearPassword();
  let latest = START;
  void runInstall(choice, password, dryRun, (event) => {
    latest = advance(latest, event);
    ops.setProgress(latest);
  }).then((code) => {
    if (latest.ok === true && code === 0) ops.setPage("done");
    else {
      if (!latest.failed) {
        const message = code === null ? "The installer couldn't start (pkexec or dashi-install is missing)." : "The installer stopped without saying why.";
        latest = { ...latest, failed: { step: latest.step ?? "check", message } };
        ops.setProgress(latest);
      }
      ops.setPage("failed");
    }
  });
}

export function useInstaller(): Wizard {
  const [page, setPage] = useState<Page>("welcome");
  const [machine, setMachine] = useState<Machine | null>(null);
  const [disk, setDisk] = useState<string | null>(null);
  const [account, setAccount] = useState<Account>({ fullName: "", user: "", password: "", confirm: "", hostname: "dashi" });
  // Typed by hand, the account and computer names stop following the full name.
  const named = useRef({ user: false, hostname: false });
  const [nvidia, setNvidia] = useState(false);
  const [progress, setProgress] = useState<Progress>(START);
  const dryRun = useRef(isDryRun()).current;

  useEffect(() => {
    void probeMachine().then((found) => {
      setMachine(found);
      setNvidia(found.nvidia);
      const usable = found.disks.filter((each) => !each.unavailable);
      if (usable.length === 1) setDisk(usable[0]?.path ?? null);
    });
  }, []);

  const chosen = machine?.disks.find((each) => each.path === disk) ?? null;
  const setName = (fullName: string): void =>
    setAccount((was) => {
      const user = named.current.user ? was.user : suggestUser(fullName);
      return { ...was, fullName, user, hostname: named.current.hostname ? was.hostname : suggestHostname(user) };
    });
  const setUser = (user: string): void => {
    named.current.user = true;
    setAccount((was) => ({ ...was, user, hostname: named.current.hostname ? was.hostname : suggestHostname(user) }));
  };
  const setHostname = (hostname: string): void => {
    named.current.hostname = true;
    setAccount((was) => ({ ...was, hostname }));
  };
  const edit = (patch: Partial<Account>): void => setAccount((was) => ({ ...was, ...patch }));

  const install = (): void => {
    if (!chosen) return;
    setPage("installing");
    setProgress(START);
    startInstall(chosen, account, nvidia, dryRun, {
      setPage,
      setProgress,
      clearPassword: () => setAccount((was) => ({ ...was, password: "", confirm: "" })),
    });
  };

  return {
    page,
    setPage,
    machine,
    disk,
    setDisk,
    chosen,
    account,
    edit,
    setName,
    setUser,
    setHostname,
    nvidia,
    setNvidia,
    progress,
    dryRun,
    install,
  };
}
