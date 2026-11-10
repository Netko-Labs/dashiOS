//! The selections between X11 and Wayland apps (XwmHandler's selection calls,
//! wm.rs): the clipboard and the primary selection, both ways.

use std::os::fd::OwnedFd;

use smithay::wayland::selection::{
    SelectionTarget,
    data_device::{
        clear_data_device_selection, current_data_device_selection_userdata,
        request_data_device_client_selection, set_data_device_selection,
    },
    primary_selection::{
        clear_primary_selection, current_primary_selection_userdata,
        request_primary_client_selection, set_primary_selection,
    },
};

use crate::state::Dashi;

impl Dashi {
    /// Whether an X11 app may read the clipboard: only one with the keyboard.
    pub(super) fn x11_may_read_selection(&self) -> bool {
        // Only an X11 app with the keyboard reads the clipboard.
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| {
                self.windows
                    .by_surface(&focus)
                    .is_some_and(|e| e.window.x11_surface().is_some())
            })
    }

    /// An X11 app reads a Wayland app's selection.
    pub(super) fn send_selection_to_x11(
        &mut self,
        selection: SelectionTarget,
        mime_type: String,
        fd: OwnedFd,
    ) {
        let result = match selection {
            SelectionTarget::Clipboard => {
                request_data_device_client_selection(&self.seat, mime_type, fd)
                    .map_err(|e| format!("{e:?}"))
            }
            SelectionTarget::Primary => request_primary_client_selection(&self.seat, mime_type, fd)
                .map_err(|e| format!("{e:?}")),
        };
        if let Err(error) = result {
            tracing::debug!(error, "handing the Wayland selection to an X11 app");
        }
    }

    /// An X11 app set a selection: Wayland apps see it (and the shell hears of the clipboard).
    pub(super) fn x11_selection_set(
        &mut self,
        selection: SelectionTarget,
        mime_types: Vec<String>,
    ) {
        match selection {
            SelectionTarget::Clipboard => {
                self.report_selection(&mime_types, true);
                set_data_device_selection(&self.display_handle, &self.seat, mime_types, ())
            }
            SelectionTarget::Primary => {
                set_primary_selection(&self.display_handle, &self.seat, mime_types, ())
            }
        }
    }

    /// An X11 app cleared its selection: cleared for Wayland apps too, if it was there.
    pub(super) fn x11_selection_cleared(&mut self, selection: SelectionTarget) {
        match selection {
            SelectionTarget::Clipboard
                if current_data_device_selection_userdata(&self.seat).is_some() =>
            {
                clear_data_device_selection(&self.display_handle, &self.seat)
            }
            SelectionTarget::Primary
                if current_primary_selection_userdata(&self.seat).is_some() =>
            {
                clear_primary_selection(&self.display_handle, &self.seat)
            }
            _ => {}
        }
    }
}
