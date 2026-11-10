/**
 * Which accounts the shell talks to: AccountsService and `passwd`, or the
 * stand-in. A development run gets the stand-in, never the machine's accounts
 * (`system/stand-in.ts` says when a run is one; `DASHI_FAKE_NM` forces it
 * either way, as for Wi-Fi and Bluetooth).
 */

import { AccountsServiceBackend } from "../shared/accounts/backend.ts";
import type { AccountsBackend, PasswordChanger } from "../shared/accounts/types.ts";
import { type Nesting, standsIn } from "../system/stand-in.ts";
import { FakeAccounts } from "./lib/fake.ts";
import { bunPty, spawnPasswd } from "./lib/passwd.ts";

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
