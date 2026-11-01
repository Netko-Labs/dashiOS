# @dashi/greeter

Dashi's login screen. greetd runs it through `session/dashi-greeter`, inside
`dashi-comp`; it draws `@dashi/ui`'s `LoginScreen` (the lock screen's too)
with mirin Metal, on one layer-shell surface over the whole screen.

- `src/greetd/`: greetd's IPC (`protocol.ts`), a connection (`client.ts`),
  and the login flow (`login.ts`): open a session, answer PAM, start the
  chosen session. The password goes to greetd and nowhere else.
- `src/users.ts`, `src/sessions.ts`: who can log in (`/etc/passwd`, regular
  ids, a login shell) and what can start (`wayland-sessions`, Dashi's first).
- `src/memory.ts`: the last user and session, in the greeter's state folder.
- `src/view.tsx`, `src/main.tsx`: the screen and the process.

Once the session is chosen, the greeter ends its compositor
(`DASHI_GREETER_COMPOSITOR`) so greetd can start it.

```sh
bun test                      # protocol, login flow, parsers
vm/vm checkout-greeter on     # the VM logs in through this checkout's greeter
```
