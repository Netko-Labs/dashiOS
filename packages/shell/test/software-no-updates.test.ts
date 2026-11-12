import { expect, test } from "bun:test";
import { Software } from "../src/shared/software/index.ts";

// PackageKit's own words when nothing is pending. pkcon exits 5 then ("nothing
// useful was done"), which Software used to show as "Updates couldn't be checked".
const NOTHING = "Transaction:\tGetting updates\nStatus: \tFinished\nResults:\nThere are no updates available at this time.\n";

function software(code: number, output: string): Software {
  return new Software({ run: async () => ({ code, output }), which: (program) => `/fake/${program}`, launch: () => {} });
}

test("no pending updates is an answer, not a failure", async () => {
  expect(await software(5, NOTHING).systemUpdates()).toEqual({ updates: [], restartCauses: [] });
  expect((await software(5, NOTHING).updateSystem(() => {})).ok).toBe(true);
});

test("another failure with status 5 is still a failure", async () => {
  await expect(software(5, "Failed to contact PackageKit\n").systemUpdates()).rejects.toThrow();
});
