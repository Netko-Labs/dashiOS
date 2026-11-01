/** Files' command line: `[--host <path>] [folder or file or file:// URI…]`. */

export interface Args {
  host?: string;
  paths: string[];
}

export function parseArgs(argv: readonly string[]): Args {
  const paths: string[] = [];
  let host: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--host") {
      host = argv[++i];
    } else if (!arg.startsWith("--")) {
      paths.push(arg);
    }
  }
  return { ...(host ? { host } : {}), paths };
}
