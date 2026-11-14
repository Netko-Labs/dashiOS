//! `_NET_ACTIVE_WINDOW`: an X11 app asking for one of its windows to be shown
//! and given the keyboard (Steam opened again while it runs, a browser asked
//! to open a link). smithay's X11Wm ignores the request, so a second X
//! connection, on a thread of its own, listens for it on the root window
//! (EWMH sends it there to every client that selects substructure events)
//! and hands it to the loop.
//!
//! Whether it is shown follows xdg-activation's rule as far as X11 allows (no
//! tokens): a window that is minimized or hidden comes back (the app asked
//! for it, as `WM_CHANGE_STATE` does), as does a request from a pager or
//! while an X11 app has the keyboard. Otherwise it wants attention.

use std::thread;

use smithay::reexports::calloop::channel::{self, Event as ChannelEvent, Sender};
use x11rb::{
    connection::Connection,
    protocol::{
        Event,
        xproto::{ChangeWindowAttributesAux, ConnectionExt, EventMask},
    },
    rust_connection::RustConnection,
};

use crate::{state::Dashi, wm::Shown};

/// `_NET_ACTIVE_WINDOW`'s source: a pager or taskbar, acting for the person.
const FROM_PAGER: u32 = 2;

/// One request: the window, and who asked (EWMH's source indication).
struct Activate {
    window: u32,
    source: u32,
}

impl Dashi {
    /// Listen for `_NET_ACTIVE_WINDOW` on Xwayland's display `display`. The
    /// listener ends with the connection, when Xwayland stops.
    pub(super) fn listen_x11_activation(&mut self, display: u32) {
        let (sender, receiver) = channel::channel::<Activate>();
        let inserted = self
            .loop_handle
            .insert_source(receiver, |event, _, state| match event {
                ChannelEvent::Msg(request) => state.x11_activate(request.window, request.source),
                ChannelEvent::Closed => {}
            });
        if let Err(error) = inserted {
            tracing::warn!(%error, "X11 apps can't ask to be shown");
            return;
        }
        let spawned = thread::Builder::new()
            .name("x11-activation".into())
            .spawn(move || {
                if let Err(error) = listen(display, &sender) {
                    tracing::debug!(%error, "X11 activation listener stopped");
                }
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "X11 apps can't ask to be shown");
        }
    }

    fn x11_activate(&mut self, window: u32, source: u32) {
        let Some(entry) = self.windows.entries().find(|e| {
            e.announced
                && e.window.x11_surface().is_some_and(|x| {
                    x.window_id() == window || x.mapped_window_id() == Some(window)
                })
        }) else {
            return;
        };
        let id = entry.id;
        let parked = entry.shown != Shown::Normal;
        let asked = parked || source == FROM_PAGER || self.xwayland.focused.is_some();
        if asked && self.activation_may_switch(id) {
            if let Err(error) = self.focus_window(id) {
                tracing::debug!(%error, "activating an X11 window");
            }
        } else {
            self.want_attention(id);
        }
    }
}

/// The listener: its own connection, substructure events on the root, and
/// every `_NET_ACTIVE_WINDOW` sent there passed on until either side closes.
fn listen(display: u32, sender: &Sender<Activate>) -> Result<(), Box<dyn std::error::Error>> {
    let (connection, screen) = RustConnection::connect(Some(&format!(":{display}")))?;
    let root = connection.setup().roots[screen].root;
    let atom = connection
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")?
        .reply()?
        .atom;
    connection
        .change_window_attributes(
            root,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::SUBSTRUCTURE_NOTIFY),
        )?
        .check()?;
    loop {
        if let Event::ClientMessage(message) = connection.wait_for_event()?
            && message.type_ == atom
            && message.format == 32
        {
            let source = message.data.as_data32()[0];
            if sender
                .send(Activate {
                    window: message.window,
                    source,
                })
                .is_err()
            {
                return Ok(());
            }
        }
    }
}
