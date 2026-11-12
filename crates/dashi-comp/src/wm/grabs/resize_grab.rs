//! Adapted from smithay's smallvil example (MIT, github.com/Smithay/smithay, v0.7.0).
//! xdg windows resize through configures and their next commit; X11 windows
//! take their new geometry at once. At the first motion the shell hears the
//! person began to resize (`window-grab`), and the window stops being
//! maximized: its size is the person's now, not the screen's.

mod pointer;
mod state;

use smithay::{
    desktop::Window,
    input::pointer::GrabStartData as PointerGrabStartData,
    reexports::wayland_protocols::xdg::shell::server::xdg_toplevel,
    utils::{Logical, Rectangle, Size},
    wayland::{compositor, seat::WaylandFocus, shell::xdg::SurfaceCachedState},
};

use self::state::ResizeSurfaceState;
pub use self::state::handle_commit;
use crate::state::Dashi;

bitflags::bitflags! {
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub struct ResizeEdge: u32 {
        const TOP          = 0b0001;
        const BOTTOM       = 0b0010;
        const LEFT         = 0b0100;
        const RIGHT        = 0b1000;

        const TOP_LEFT     = Self::TOP.bits() | Self::LEFT.bits();
        const BOTTOM_LEFT  = Self::BOTTOM.bits() | Self::LEFT.bits();

        const TOP_RIGHT    = Self::TOP.bits() | Self::RIGHT.bits();
        const BOTTOM_RIGHT = Self::BOTTOM.bits() | Self::RIGHT.bits();
    }
}

impl From<xdg_toplevel::ResizeEdge> for ResizeEdge {
    #[inline]
    #[expect(
        clippy::unwrap_used,
        reason = "H12 offender: say why it cannot fail (expect) or fall back"
    )]
    fn from(x: xdg_toplevel::ResizeEdge) -> Self {
        Self::from_bits(x as u32).unwrap()
    }
}

pub struct ResizeSurfaceGrab {
    start_data: PointerGrabStartData<Dashi>,
    window: Window,

    edges: ResizeEdge,

    initial_rect: Rectangle<i32, Logical>,
    last_window_size: Size<i32, Logical>,
    /// The shell has heard of it (the first motion).
    reported: bool,
}

impl ResizeSurfaceGrab {
    pub fn start(
        start_data: PointerGrabStartData<Dashi>,
        window: Window,
        edges: ResizeEdge,
        initial_window_rect: Rectangle<i32, Logical>,
    ) -> Self {
        let initial_rect = initial_window_rect;

        if let Some(toplevel) = window.toplevel() {
            ResizeSurfaceState::with(toplevel.wl_surface(), |state| {
                *state = ResizeSurfaceState::Resizing {
                    edges,
                    initial_rect,
                };
            });
        }

        Self {
            start_data,
            window,
            edges,
            initial_rect,
            last_window_size: initial_rect.size,
            reported: false,
        }
    }
}

impl ResizeSurfaceGrab {
    /// An X11 window takes the size now; resizing by the top or left moves it too.
    fn resize_x11(&self, data: &mut Dashi) {
        let Some(x11) = self.window.x11_surface() else {
            return;
        };
        let size = self.last_window_size;
        let mut at = self.initial_rect.loc;
        if self.edges.intersects(ResizeEdge::LEFT) {
            at.x += self.initial_rect.size.w - size.w;
        }
        if self.edges.intersects(ResizeEdge::TOP) {
            at.y += self.initial_rect.size.h - size.h;
        }
        let _ = x11.configure(Rectangle::new(at, size));
        data.space.map_element(self.window.clone(), at, false);
    }
}

/// The smallest and largest size the client allows (0: no limit).
pub(crate) fn size_limits(window: &Window) -> (Size<i32, Logical>, Size<i32, Logical>) {
    if let Some(x11) = window.x11_surface() {
        return (
            x11.min_size().unwrap_or_default(),
            x11.max_size().unwrap_or_default(),
        );
    }
    let Some(surface) = window.wl_surface() else {
        return Default::default();
    };
    compositor::with_states(&surface, |states| {
        let mut guard = states.cached_state.get::<SurfaceCachedState>();
        let data = guard.current();
        (data.min_size, data.max_size)
    })
}
