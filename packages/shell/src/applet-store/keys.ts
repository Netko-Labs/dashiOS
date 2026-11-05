/**
 * Dashi's public key for the applet catalog's index (minisign's base64 line;
 * docs/applets.md, "Keys"). The maintainers make the key once
 * (`minisign -G`), keep the secret half offline and in the catalog's GitHub
 * Actions secrets, and put the public half here. Until then this is null and
 * the store says it isn't set up; `DASHI_APPLETS_KEY` (a .pub file or the
 * line) stands in for a test catalog.
 */
export const DASHI_INDEX_KEY: string | null = null;
