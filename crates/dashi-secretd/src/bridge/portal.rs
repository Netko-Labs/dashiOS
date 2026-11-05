//! The portal's Secret backend (org.freedesktop.impl.portal.Secret): a
//! sandboxed app (a Flatpak) gets one secret of its own, made on first use and
//! kept in the vault, to encrypt what it stores. Only xdg-desktop-portal may
//! call this: it says which app is asking, and an app calling the backend
//! directly could claim to be any app.

use std::{collections::HashMap, io::Write, sync::Arc};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use zbus::{
    Connection, fdo, interface,
    message::Header,
    zvariant::{OwnedFd, OwnedObjectPath, OwnedValue},
};
use zeroize::Zeroizing;

use super::{Shared, peer};

pub const PATH: &str = "/org/freedesktop/portal/desktop";
pub const NAME: &str = "org.freedesktop.impl.portal.desktop.dashi.secret";

pub struct Portal {
    pub shared: Arc<Shared>,
}

/// Whether `pid` is xdg-desktop-portal itself.
fn is_portal(pid: u32) -> bool {
    std::fs::read_link(format!("/proc/{pid}/exe")).is_ok_and(|exe| {
        exe.file_name()
            .is_some_and(|name| name == "xdg-desktop-portal")
    })
}

#[interface(name = "org.freedesktop.impl.portal.Secret")]
impl Portal {
    async fn retrieve_secret(
        &self,
        _handle: OwnedObjectPath,
        app_id: &str,
        fd: OwnedFd,
        _options: HashMap<String, OwnedValue>,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        let peer = peer::check(connection, &header).await?;
        if !is_portal(peer.pid) {
            return Err(fdo::Error::AccessDenied(
                "only xdg-desktop-portal may ask".into(),
            ));
        }
        // An unsandboxed app has no app id; it has the Secret Service itself.
        if app_id.is_empty() {
            return Ok((2, HashMap::new()));
        }
        let reply = self
            .shared
            .call(&json!({ "op": "app-secret", "appId": app_id }))?;
        let secret = Zeroizing::new(
            STANDARD
                .decode(reply["secret"].as_str().unwrap_or_default())
                .map_err(|_| fdo::Error::Failed("a damaged secret".into()))?,
        );
        let mut file = std::fs::File::from(std::os::fd::OwnedFd::from(fd));
        file.write_all(&secret)
            .map_err(|e| fdo::Error::IOError(e.to_string()))?;
        Ok((0, HashMap::new()))
    }

    #[zbus(property, name = "version")]
    async fn version(&self) -> u32 {
        1
    }
}
