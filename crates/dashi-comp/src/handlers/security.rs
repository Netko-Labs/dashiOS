//! security-context: a sandbox (Flatpak) opens a socket for its app, and every
//! client that connects there is marked sandboxed. A sandboxed client never
//! counts as the shell's (session/trust.rs) and is never granted screencopy,
//! even though its process runs under the shell and its executable path may
//! be a granted one.

use std::sync::Arc;

use smithay::{
    delegate_security_context,
    reexports::wayland_server::DisplayHandle,
    wayland::security_context::{
        SecurityContext, SecurityContextHandler, SecurityContextListenerSource,
        SecurityContextState,
    },
};

use crate::state::{ClientState, Dashi};

pub(crate) fn create_global(dh: &DisplayHandle) {
    // A sandboxed client may not make itself another context.
    SecurityContextState::new::<Dashi, _>(dh, |client| {
        client
            .get_data::<ClientState>()
            .is_none_or(|data| data.sandbox.is_none())
    });
}

impl SecurityContextHandler for Dashi {
    fn context_created(&mut self, source: SecurityContextListenerSource, context: SecurityContext) {
        tracing::info!(
            engine = context.sandbox_engine.as_deref().unwrap_or("?"),
            app = context.app_id.as_deref().unwrap_or("?"),
            "a sandbox opened a Wayland socket"
        );
        let inserted = self
            .loop_handle
            .insert_source(source, move |stream, _, state| {
                let data = ClientState {
                    sandbox: Some(context.clone()),
                    ..ClientState::default()
                };
                if let Err(error) = state.display_handle.insert_client(stream, Arc::new(data)) {
                    tracing::warn!(%error, "a sandboxed client could not connect");
                }
            });
        if let Err(error) = inserted {
            tracing::warn!(%error, "watching a sandbox's socket");
        }
    }
}

delegate_security_context!(Dashi);
