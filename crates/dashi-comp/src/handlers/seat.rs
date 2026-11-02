//! wl_seat, the clipboard and drag-and-drop (wl_data_device), and wl_output.

use smithay::{
    delegate_data_device, delegate_output, delegate_primary_selection, delegate_seat,
    input::{Seat, SeatHandler, SeatState, pointer::CursorImageStatus},
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    wayland::{
        output::OutputHandler,
        selection::{
            SelectionHandler, SelectionSource, SelectionTarget,
            data_device::{
                ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
                set_data_device_focus,
            },
            primary_selection::{
                PrimarySelectionHandler, PrimarySelectionState, set_primary_focus,
            },
        },
    },
};

use std::os::fd::OwnedFd;

use crate::state::Dashi;

impl SeatHandler for Dashi {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<Dashi> {
        &mut self.seat_state
    }

    // The cursor the client asks for (render/cursor.rs draws it).
    fn cursor_image(&mut self, _seat: &Seat<Self>, image: CursorImageStatus) {
        self.cursor_status = image;
    }

    // Caps Lock and friends light up on the keyboards.
    fn led_state_changed(&mut self, seat: &Seat<Self>, leds: smithay::input::keyboard::LedState) {
        if seat == &self.seat
            && let crate::backend::Backend::Udev(data) = &mut self.backend
        {
            data.set_leds(leds);
        }
    }

    fn focus_changed(&mut self, seat: &Seat<Self>, focused: Option<&WlSurface>) {
        if let Some(entry) = focused.and_then(|surface| self.windows.by_surface_mut(surface)) {
            entry.attention = false;
        }
        let client = focused.and_then(|surface| self.display_handle.get_client(surface.id()).ok());
        set_data_device_focus(&self.display_handle, seat, client.clone());
        set_primary_focus(&self.display_handle, seat, client);
        if seat == &self.seat {
            self.x11_focus(focused);
        }
    }
}

delegate_seat!(Dashi);

impl SelectionHandler for Dashi {
    type SelectionUserData = ();

    // A Wayland app's clipboard or primary selection, offered to X11 apps too.
    fn new_selection(
        &mut self,
        ty: SelectionTarget,
        source: Option<SelectionSource>,
        _seat: Seat<Self>,
    ) {
        let Some(wm) = self.xwayland.wm.as_mut() else {
            return;
        };
        let mime_types = source.map(|source| source.mime_types());
        if let Err(error) = wm.new_selection(ty, mime_types) {
            tracing::debug!(?error, "offering a selection to X11 apps");
        }
    }

    // A Wayland app reads what an X11 app copied.
    fn send_selection(
        &mut self,
        ty: SelectionTarget,
        mime_type: String,
        fd: OwnedFd,
        _seat: Seat<Self>,
        _user_data: &(),
    ) {
        let Some(wm) = self.xwayland.wm.as_mut() else {
            return;
        };
        if let Err(error) = wm.send_selection(ty, mime_type, fd, self.loop_handle.clone()) {
            tracing::debug!(?error, "reading an X11 app's selection");
        }
    }
}

impl PrimarySelectionHandler for Dashi {
    fn primary_selection_state(&self) -> &PrimarySelectionState {
        &self.primary_selection_state
    }
}

delegate_primary_selection!(Dashi);

// Only created outside greeter mode (state.rs); never asked for otherwise.
impl smithay::wayland::selection::ext_data_control::DataControlHandler for Dashi {
    fn data_control_state(
        &self,
    ) -> &smithay::wayland::selection::ext_data_control::DataControlState {
        match &self.data_control {
            Some((ext, _)) => ext,
            None => unreachable!("ext-data-control has no global in greeter mode"),
        }
    }
}

impl smithay::wayland::selection::wlr_data_control::DataControlHandler for Dashi {
    fn data_control_state(
        &self,
    ) -> &smithay::wayland::selection::wlr_data_control::DataControlState {
        match &self.data_control {
            Some((_, wlr)) => wlr,
            None => unreachable!("wlr-data-control has no global in greeter mode"),
        }
    }
}

smithay::delegate_ext_data_control!(Dashi);
smithay::delegate_data_control!(Dashi);

impl DataDeviceHandler for Dashi {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}

impl ClientDndGrabHandler for Dashi {}
impl ServerDndGrabHandler for Dashi {}

delegate_data_device!(Dashi);

impl OutputHandler for Dashi {}
delegate_output!(Dashi);
