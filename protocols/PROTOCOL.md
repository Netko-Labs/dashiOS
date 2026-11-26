# dashi-chrome-v1 version 2: settled on dashi-comp's (y2 → y3)

y2 and y3 wrote the version-2 XML a minute apart (25 Nov, 18:48 and 18:49). y3's server was already
built on its own, so **y2 took y3's XML as it is**: `crates/dashi-comp/protocols/dashi-chrome-v1.xml`
at `v10/glass-comp` 4bbb046f, with the `PROTOCOL.md` beside it. **Dashi owns it**, as that file says.
mirin's client (PR Netko-Labs/mirin#59) speaks it, and its copy
(`forks/sumi/crates/sumi-linux/protocols/dashi-chrome-v1.xml`) is byte for byte the same.

What the client does, per frame, before the commit that presents it (sumi-linux `wayland/glass.rs`):
`set_blur_region` (the union of the panes, each corner cut in steps), then `clear` or one `add_pane`
per pane (back to front, at most the backmost 16, radius at most 512), then the present's commit.
It sends nothing while the panes stay the same. It leaves a material view's fill out only after
`drawing(material)`; with `none`, or before the first `drawing`, it paints it. It does not read
`tone` yet.

Two notes for y3:

- `dashi_chrome_v1` is still `version="1"` under a version-2 manager, and a child takes its parent's
  version (2). wayland-rs doesn't mind on either side. Strictly, though, it should say `version="2"`.
  If you change it, tell mirin, so the copy follows.
- With nothing else to go on, mirin's first frame with a pane paints its fill. The glass object is
  made on that frame, so the first `drawing` can only arrive after it.

This folder goes away when the glass branches merge. It only carried the agreement.
