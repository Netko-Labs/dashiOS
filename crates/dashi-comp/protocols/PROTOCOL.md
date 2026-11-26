# Dashi's Wayland protocols

`dashi-chrome-v1.xml` is Dashi's own protocol. **Dashi owns it** (dashi-comp serves it; a change
lands here first, with the server). mirin keeps a byte-for-byte copy in
`forks/sumi/crates/sumi-linux/protocols/` for its client; when this file changes, copy it there.

## Version 1: unified chrome

`get_chrome(toplevel)` → `dashi_chrome_v1.set_style(unified)`: no title bar, the traffic lights
over the window; `controls` says where they are.

## Version 2: glass (Dashi 0.10, decisions.md D730–D749)

For each surface with glass, a client sends, **in the same `wl_surface.commit` as the buffer that
draws on it**:

1. `ext_background_effect_surface_v1.set_blur_region(region)`: the union of its panes (the region is
   what every compositor that blurs reads);
2. `dashi_glass_v1.add_pane(x, y, width, height, radius, level)` once per pane (at most 16): the
   corner radius and the material, which a region can't say.

Then `commit`. A commit with neither `add_pane` nor `clear` keeps the panes as they are. `clear`
then `commit` removes them.

| level | value | wears it |
|---|---|---|
| thin | 0 | the bar, the Dock |
| regular | 1 | menus, Control Center, the launcher and its conversation, banners, sheets |
| thick | 2 | the focused window's sidebar |
| paper | 3 | widgets |
| veil | 4 | the lock screen's wallpaper |

What a level looks like (blur, saturation, tint per mode, grain, rim, keel, the contrast floor)
is the shell's: it sends the numbers to dashi-comp over IPC (`glass-style`), from `@dashi/ui`'s
`theme/glass.ts`. A client never sends a colour.

Events:

- `drawing(material | none)`: sent when the object is made and when it changes. `material`: the
  compositor draws the panes (frosted, wallpaper-only under battery saver, or the level's solid twin
  under Reduce Transparency): paint **no fill** under them. `none`: it doesn't (the person turned glass
  off for this app, or the GPU can't): paint the fill you'd paint without glass.
- `tone(0xRRGGBB)`: the mean colour of what is behind the first pane, blurred and lifted, before the
  tint: at once for new panes (their first frame of glass, still or moving behind) and for a new
  `dashi_glass_v1` of a surface whose tone is known; then when it settles after a change, at most
  every 120 ms, and once a second while it keeps changing. Words on glass lean toward its hue
  (Frost's vibrant inks).

Rules the server keeps:

- Where a surface has panes, they are its glass and its blur region is not read. A surface with a
  blur region and no panes (an app that isn't Dashi's: foot, kitty) is blurred in that region with
  `regular`'s blur and saturation and no tint, no rim, no floor: the app tints itself.
- Panes are clipped to the surface; a radius is held to half the pane's shorter side.
- Glass is granted per client by the shell (`glass-clients`): the shell's own processes always;
  other apps unless the person turned it off. Not granted: `ext_background_effect_manager_v1`
  sends `capabilities(0)` and `dashi_glass_v1` sends `drawing(none)`, and nothing is drawn.

## Without the protocol

A client on a compositor without `dashi_chrome_manager_v1` v2 sends only the blur region (or
nothing) and paints its own fill, as today.
