/**
 * A system error (from fs or a subprocess) as the code reads it: an object
 * with a string `code` such as ENOENT or EEXIST. Anything else is not one, so
 * a caller checks the code instead of casting the error (H7).
 */

export function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string";
}
