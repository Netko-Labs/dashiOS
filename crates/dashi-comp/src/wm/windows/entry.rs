//! One window as the compositor tracks it.

use smithay::{
    desktop::Window,
    utils::{Logical, Point, Rectangle},
};

use super::{Shown, WindowId};
use crate::render::titlebar::{self, Decor};

pub(crate) struct Entry {
    pub id: WindowId,
    pub window: Window,
    /// The shell has been told about it (`window-opened`): it is placed and has drawn something.
    pub announced: bool,
    /// Placed on screen (by the shell's `place`, or the fallback); until then it is not mapped.
    pub placed: bool,
    /// `window-placing` went out; waiting for the shell's answer.
    pub placing: bool,
    pub shown: Shown,
    /// Where its frame was when it last left the screen (minimized, hidden).
    pub parked_at: Option<Point<i32, Logical>>,
    /// The client was last told it is maximized (`frame` with `maximized`: the shell's Fill).
    pub maximized: bool,
    /// The shell framed it as a tile (`frame` with `tiled`), until another
    /// frame, Fill, full screen, or the person moves or resizes it: its
    /// depth is a tile's (render/depth/).
    pub tiled: bool,
    /// How it is framed: by the client, by dashi-comp's title bar, or unified.
    pub decor: Decor,
    /// The app asked for the unified style (dashi-chrome-v1).
    pub unified: bool,
    /// The title bar (or a unified window's lights) as last drawn, at each
    /// scale a screen draws it at (`Dashi::decor_scale` is the one drawing).
    pub title_images: crate::wm::by_scale::ByScale<titlebar::Image>,
    /// Full screen on this output, and the outer frame to go back to.
    pub fullscreen: Option<(String, Rectangle<i32, Logical>)>,
    /// The Space it is on.
    pub space: usize,
    /// Where it was while its Space is not shown.
    pub away_at: Option<Point<i32, Logical>>,
    /// Its place in its Space's stack while that Space is not shown (higher
    /// is nearer the front): stamped as it leaves the screen, so the Space
    /// comes back, slides in, and is pictured in the order it had.
    pub away_rank: u64,
    /// It asked for focus and was refused; cleared when it gets the keyboard.
    pub attention: bool,
    /// The title bar control under the pointer, if any (the controls light up).
    pub hover: Option<crate::render::titlebar::Part>,
    /// Its icon (xdg-toplevel-icon), as last told.
    pub icon: crate::handlers::toplevel_meta::Icon,
    /// The window it is a sheet of (IPC `attach`; wm/sheets.rs).
    pub sheet_of: Option<WindowId>,
    /// As a sheet: how far below the top of its parent's frame it hangs
    /// (`attach {top}`: an app's own title bar and toolbar); None is under
    /// the title bar dashi-comp draws.
    pub sheet_top: Option<i32>,
    /// When it last got the person's keyboard (a count, higher is later; 0 never).
    pub used: u64,
    /// Its shadow and edge as last drawn (render/depth/).
    pub depth: crate::render::depth::Cache,
}
