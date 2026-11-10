/**
 * The applets channel, `$XDG_RUNTIME_DIR/dashi-applets.sock`: how a program
 * puts its own items in the menu bar's status area (docs/applets.md).
 * Newline-delimited JSON, one message per line. The shell parses with this
 * module (its src/applets/protocol.ts is the facade), and so does the client,
 * so both sides refuse the same things.
 *
 * Version 1:
 *   applet → shell  {"type":"applet","applet":{…}}  {"type":"remove","id":"weather"}
 *   shell → applet  {"type":"activate","id","x","y"}  {"type":"select","id","item"}  {"type":"error","message"}
 * Version 2 adds, first on the connection:
 *   applet → shell  {"type":"hello","protocol":2,"manifest":{…},"dev"?:true}
 *   shell → applet  {"type":"welcome","protocol":2}
 * and then popovers and nested menus:
 *   applet → shell  {"type":"popover","id","width","height"}   (open one under the item `id`)
 *                   {"type":"dismiss","id"}                      (it closed)
 *   shell → applet  {"type":"popover","id","x","y","width","height","output","namespace"}  (where to put it)
 *                   {"type":"dismiss","id"}                      (close it: a click outside, the item again)
 * Version 3 (a hello with `"protocol":3`) adds the launcher's commands
 * (commands.ts; the manifest declares them):
 *   shell → applet  {"type":"run","seq","command","args","query"?,"item"?}   (run it; a pick command's rows for `query`; the row chosen)
 *   applet → shell  {"type":"result","seq","text"|"copy"|"open"|"error"}    (what it came to)
 *                   {"type":"items","seq","rows":[{"id","title","detail"?}]} (a pick command's rows, drawn by the shell)
 *                   {"type":"view","seq","height"}                          (a view command draws its answer itself, this tall)
 *   shell → applet  {"type":"view","seq","x","y","width","height","output","namespace"}  (where)
 *   either way      {"type":"dismiss","seq"}                                 (the view closed)
 * Version 4 adds Dashi's power mode, for an applet with the `power.mode`
 * permission (power.ts):
 *   shell → applet  {"type":"power","choice","available","mode","automatic","why","failed"}  (after welcome, and on every change)
 *   applet → shell  {"type":"power","choice"}                                (ask for Automatic or a mode)
 * Version 5 adds Control Center's controls, for an applet that declares
 * them and has the `controls` permission (controls.ts):
 *   shell → applet  {"type":"controls","shown":[…]}                          (which of its controls are in Control Center)
 *                   {"type":"control-action","id","action",…}               (one was pressed)
 *   applet → shell  {"type":"control","id","on"?,"detail"?,"choice"?,"value"?,"glyph"?}  (its state)
 * A connection that starts with anything but `hello` is version 1, and
 * stays so. A hello's protocol is the newest the applet speaks; the
 * connection speaks the older of it and the shell's.
 */

export * from "./protocol-applet.ts";
export * from "./protocol-shell.ts";
export * from "./protocol-types.ts";
