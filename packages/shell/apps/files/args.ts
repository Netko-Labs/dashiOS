/**
 * Files' command line: `[--host <path>] [--info] [folder or file or file:// URI…]`.
 * `--info` opens Get Info for the item named (the file manager service's
 * ShowItemProperties).
 */

export interface Args {
  host?: string;
  paths: string[];
  info?: true;
}

export function parseArgs(argv: readonly string[]): Args {
  const paths: string[] = [];
  let host: string | undefined;
  let info = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--host") {
      host = argv[++i];
    } else if (arg === "--info") {
      info = true;
    } else if (!arg.startsWith("--")) {
      paths.push(arg);
    }
  }
  return { ...(host ? { host } : {}), paths, ...(info ? { info: true as const } : {}) };
}
