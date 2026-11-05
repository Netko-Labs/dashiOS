/**
 * The test site's passkeys (WebAuthn). The pages come with the virtual
 * security key (docs/secrets.md, "Passkeys"); until then there are none.
 */

export function passkeyRoutes(_events: string[]): (request: Request, url: URL) => Promise<Response | null> {
  return async () => null;
}
