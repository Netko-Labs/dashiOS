/**
 * Which accounts the shell talks to: AccountsService and `passwd`, or the
 * stand-in. A development run gets the stand-in, never the machine's accounts
 * (`system/stand-in.ts` says when a run is one; `DASHI_FAKE_NM` forces it
 * either way, as for Wi-Fi and Bluetooth).
 */

import { type Nesting, standsIn } from "../system/stand-in.ts";
import { AccountsServiceBackend } from "./backend.ts";
import { FakeAccounts } from "./fake.ts";
import { bunPty, spawnPasswd } from "./passwd.ts";
import type { AccountsBackend, PasswordChanger } from "./types.ts";

export interface AccountsSetup {
  backend: AccountsBackend;
  passwords: PasswordChanger;
  fake: boolean;
}

export function chooseAccounts(env: Record<string, string | undefined> = process.env, nesting?: Nesting): AccountsSetup {
  if (standsIn(env, nesting)) {
    const fake = new FakeAccounts();
    return { backend: fake, passwords: fake, fake: true };
  }
  return { backend: new AccountsServiceBackend(), passwords: spawnPasswd(bunPty), fake: false };
}
