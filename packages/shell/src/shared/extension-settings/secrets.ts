/**
 * Where an extension's secrets are kept: the Secret Service, through
 * `secret-tool` (libsecret's), never on disk. A preference of type `secret`
 * is `dashi-extension <id> preference <name>`; an account's token is
 * `dashi-extension <id> account <provider>`. A stand-in in tests.
 */

export interface Secrets {
  get(extension: string, name: string, kind?: SecretKind): Promise<string | null>;
  set(extension: string, name: string, label: string, value: string, kind?: SecretKind): Promise<boolean>;
  clear(extension: string, name: string, kind?: SecretKind): Promise<void>;
}

/** A preference (its name), or an account (its provider). */
export type SecretKind = "preference" | "account";

async function run(argv: readonly string[], input?: string): Promise<{ code: number; out: string }> {
  try {
    const child = Bun.spawn([...argv], { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "ignore" });
    const out = await new Response(child.stdout).text();
    return { code: await child.exited, out };
  } catch {
    return { code: 127, out: "" };
  }
}

/** The Secret Service through `secret-tool`: attributes `dashi-extension` (its id) and `preference` or `account` (the name). */
export const secretTool: Secrets = {
  get: async (extension, name, kind = "preference") => {
    const { code, out } = await run(["secret-tool", "lookup", "dashi-extension", extension, kind, name]);
    return code === 0 && out !== "" ? out : null;
  },
  set: async (extension, name, label, value, kind = "preference") =>
    (await run(["secret-tool", "store", `--label=${label}`, "dashi-extension", extension, kind, name], value)).code === 0,
  clear: async (extension, name, kind = "preference") => {
    await run(["secret-tool", "clear", "dashi-extension", extension, kind, name]);
  },
};

/** Secrets in memory, for tests and a run without a Secret Service. */
export function secretsInMemory(): Secrets & { held: Map<string, string> } {
  const held = new Map<string, string>();
  const key = (extension: string, name: string, kind: SecretKind = "preference"): string => `${extension}\u0000${kind}\u0000${name}`;
  return {
    held,
    get: async (extension, name, kind) => held.get(key(extension, name, kind)) ?? null,
    set: async (extension, name, _label, value, kind) => {
      held.set(key(extension, name, kind), value);
      return true;
    },
    clear: async (extension, name, kind) => {
      held.delete(key(extension, name, kind));
    },
  };
}
