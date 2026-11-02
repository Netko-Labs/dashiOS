/**
 * Renaming without replacing. `rename(2)` overwrites a file that appeared at
 * the destination between "is the name free?" and the rename; Linux has
 * `renameat2(RENAME_NOREPLACE)` for exactly that, and Bun reaches it through
 * `bun:ffi` (no Rust needed). Where it isn't available (an old kernel, a
 * filesystem without support) the fallback checks first and renames, which
 * leaves a tiny window that is no worse than any other file manager's.
 */

import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { lstat, rename } from "node:fs/promises";

const AT_FDCWD = -100;
const RENAME_NOREPLACE = 1;

type Renameat2 = (oldDir: number, oldPath: Uint8Array, newDir: number, newPath: Uint8Array, flags: number) => number;
type Errno = () => number;

let native: { renameat2: Renameat2; errno: Errno } | null | undefined;

function load(): { renameat2: Renameat2; errno: Errno } | null {
  if (native !== undefined) return native;
  try {
    const libc = dlopen("libc.so.6", {
      renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      // biome-ignore lint/style/useNamingConvention: libc's symbol
      __errno_location: { args: [], returns: FFIType.ptr },
    });
    const location = libc.symbols.__errno_location() as number;
    native = {
      renameat2: (a, b, c, d, flags) => libc.symbols.renameat2(a, ptr(b), c, ptr(d), flags) as number,
      errno: () => read.i32(location as never),
    };
  } catch {
    native = null;
  }
  return native;
}

const cstring = (text: string): Uint8Array => new TextEncoder().encode(`${text}\0`);

const ERRNO_CODES: Record<number, string> = {
  1: "EPERM",
  2: "ENOENT",
  13: "EACCES",
  17: "EEXIST",
  18: "EXDEV",
  20: "ENOTDIR",
  21: "EISDIR",
  22: "EINVAL",
  28: "ENOSPC",
  30: "EROFS",
  39: "ENOTEMPTY",
};
const ENOSYS = 38;

/** Moves `from` to `to`; throws an error with `code` `EEXIST` if `to` exists, and `EXDEV` across disks. */
export async function renameNoReplace(from: string, to: string): Promise<void> {
  const lib = load();
  if (lib) {
    const result = lib.renameat2(AT_FDCWD, cstring(from), AT_FDCWD, cstring(to), RENAME_NOREPLACE);
    if (result === 0) return;
    const errno = lib.errno();
    // EINVAL: this filesystem has no NOREPLACE; ENOSYS: no renameat2. Both use the checked fallback.
    if (errno !== ENOSYS && errno !== 22) {
      throw Object.assign(new Error(`rename ${from}: errno ${errno}`), { code: ERRNO_CODES[errno] ?? `E${errno}`, errno });
    }
  }
  const exists = await lstat(to).then(
    () => true,
    () => false,
  );
  if (exists) throw Object.assign(new Error(`${to} exists`), { code: "EEXIST" });
  await rename(from, to);
}
