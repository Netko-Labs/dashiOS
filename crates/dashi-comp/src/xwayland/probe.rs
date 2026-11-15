//! A connection of dashi-comp's own to Xwayland, for what smithay's X11Wm
//! never reads or cannot say: `_NET_WM_STATE` as an app set it before its
//! window showed (X11Wm only hears changes asked for after), a window's size
//! in X11's own pixels, and the screens as X11 sees them. Its answers are
//! waited for, as X11Wm waits for its own; it is never asked from inside one
//! of X11Wm's requests, which may hold the server.

use x11rb::{
    connection::Connection,
    protocol::{
        randr::ConnectionExt as _,
        xproto::{AtomEnum, ConnectionExt as _},
    },
    rust_connection::RustConnection,
};

/// A rectangle in X11's pixels: x, y, width, height.
pub(super) type Pixels = (i32, i32, i32, i32);

pub(super) struct Probe {
    connection: RustConnection,
    root: u32,
    net_wm_state: u32,
    fullscreen: u32,
}

impl Probe {
    pub(super) fn connect(display: u32) -> Option<Self> {
        let (connection, screen) = RustConnection::connect(Some(&format!(":{display}"))).ok()?;
        let root = connection.setup().roots.get(screen)?.root;
        // Monitors are RandR 1.5's: say so, or the server answers as to an older client.
        connection.randr_query_version(1, 5).ok()?.reply().ok()?;
        let atom = |name: &[u8]| Some(connection.intern_atom(false, name).ok()?.reply().ok()?.atom);
        let net_wm_state = atom(b"_NET_WM_STATE")?;
        let fullscreen = atom(b"_NET_WM_STATE_FULLSCREEN")?;
        Some(Self {
            connection,
            root,
            net_wm_state,
            fullscreen,
        })
    }

    /// Whether `window` carries `_NET_WM_STATE_FULLSCREEN` (EWMH: how an app
    /// asks for full screen before its window is shown).
    pub(super) fn says_fullscreen(&self, window: u32) -> bool {
        self.connection
            .get_property(false, window, self.net_wm_state, AtomEnum::ATOM, 0, 64)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| Some(reply.value32()?.any(|atom| atom == self.fullscreen)))
            .unwrap_or(false)
    }

    /// `window`'s size in X11's pixels.
    pub(super) fn size(&self, window: u32) -> Option<(i32, i32)> {
        let geometry = self.connection.get_geometry(window).ok()?.reply().ok()?;
        Some((i32::from(geometry.width), i32::from(geometry.height)))
    }

    /// The screens as X11 apps see them.
    pub(super) fn screens(&self) -> Vec<Pixels> {
        self.connection
            .randr_get_monitors(self.root, true)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| {
                reply
                    .monitors
                    .iter()
                    .map(|m| {
                        (
                            i32::from(m.x),
                            i32::from(m.y),
                            i32::from(m.width),
                            i32::from(m.height),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// The screen among `screens` that `rect` covers but for rounding (a logical
/// size times a fractional scale lands up to two pixels off).
pub(super) fn screen_meant(screens: &[Pixels], rect: Pixels) -> Option<Pixels> {
    let near = |a: i32, b: i32| (a - b).abs() <= 2;
    screens
        .iter()
        .copied()
        .find(|s| near(s.0, rect.0) && near(s.1, rect.1) && near(s.2, rect.2) && near(s.3, rect.3))
}

#[cfg(test)]
mod tests {
    use super::screen_meant;

    #[test]
    fn a_rounded_full_screen_frame_means_its_screen() {
        // 1920 by 1200 at 1.75 is 1098 by 686 points, which is 1922 by 1201 pixels.
        let screens = [(0, 0, 1920, 1200), (1920, 0, 2560, 1440)];
        assert_eq!(screen_meant(&screens, (0, 0, 1922, 1201)), Some(screens[0]));
        assert_eq!(
            screen_meant(&screens, (1920, 0, 2560, 1440)),
            Some(screens[1])
        );
    }

    #[test]
    fn a_window_that_is_not_a_screen_means_none() {
        let screens = [(0, 0, 1920, 1200)];
        assert_eq!(screen_meant(&screens, (0, 0, 1400, 1050)), None);
        assert_eq!(screen_meant(&screens, (100, 0, 1920, 1200)), None);
    }
}
