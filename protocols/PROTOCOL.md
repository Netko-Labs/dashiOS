# dashi-chrome-v1, version 2: glass (y2 ↔ y3)

`dashi-chrome-v1.xml` here is the one text both sides build from. Version 1 (the unified title bar) is
unchanged; version 2 adds `get_glass` and `dashi_glass_v1`.

- **Owner of the XML: y2 (mirin).** y3 (dashi-comp) serves it. A change goes in this file first:
  y3 writes what it needs under "From y3" below, y2 changes the XML and answers under it.
- **Copies:** mirin's client is generated from `forks/sumi/crates/sumi-linux/protocols/dashi-chrome-v1.xml`
  and dashi-comp's server from `crates/dashi-comp/protocols/dashi-chrome-v1.xml`. Both are byte-for-byte
  copies of this file (`cmp` them); y2 keeps mirin's, y3 keeps dashi-comp's.

## What the client (mirin's Metal host) does

Each frame, in this order, before the `wl_surface.commit` that shows it (the Vulkan present):

1. Collects the views with `material` as painted in that frame: their window rects, clipped by what
   clips them, with their own corner radius and material.
2. When they differ from the last frame's (nothing is sent otherwise):
   - `ext_background_effect_surface_v1.set_blur_region`: the union of the panes, each corner cut in
     1 px steps (sumi's `add_rounded_rect`, the same as its whole-window blur), or `NULL` when there
     are no panes;
   - `dashi_glass_v1.set_panes`: the panes, back to front (paint order).
3. Presents the frame: one commit carries the buffer, the region and the panes.

Glass is **on** for a surface when the compositor offers `dashi_chrome_manager_v1` version 2 **and**
`ext_background_effect_manager_v1` with the `blur` capability. Then the host leaves a material view's
`background` unpainted (the compositor tints). Otherwise it binds nothing, sends nothing and paints the
`background` as before. When the capability comes or goes, the host draws again.

The host binds `get_glass` and `get_background_effect` lazily, on the first frame with a pane.

## What the compositor (dashi-comp) is asked to do

- Serve the manager at version 2; `get_glass` on any `wl_surface`.
- Draw each pane of a committed surface with its material's look (the shell's `glass-style` levels),
  rounded at its radius, clipped to the blur region and the surface. Panes back to front.
- `ink` (0 = the material's own) is for the contrast floor. mirin sends 0 today (a `materialInk`
  prop is planned with y4).
- To turn glass off for a client (not granted, or off for good), send `capabilities` 0 on its
  `ext_background_effect_manager_v1`: the client paints its fills. Reduce Transparency, battery saver
  and a GPU that cannot blur are drawn by the compositor in the panes (solid twin, wallpaper-only)
  and keep the capability, so the surface's words keep the ground they were designed on.
- `tone` is optional; mirin reads none yet (y4: `useGlassTone`).

## From y3

(write here)
