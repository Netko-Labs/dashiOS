//! org.freedesktop.Secret.Session objects: closing one forgets its key.

use std::sync::Arc;

use zbus::{Connection, ObjectServer, fdo, interface, message::Header, zvariant::ObjectPath};

use super::{Shared, peer};

/// org.freedesktop.Secret.Session: closing it forgets its key.
pub struct SessionObject {
    pub(super) shared: Arc<Shared>,
    pub(super) path: String,
}

/// Forget the session at `path` if it is `sender`'s; another caller is refused.
fn forget(shared: &Shared, path: &str, sender: &str) -> fdo::Result<()> {
    let mut sessions = shared
        .sessions
        .lock()
        .map_err(|_| fdo::Error::Failed("sessions".into()))?;
    if sessions.get(path).is_some_and(|s| s.owner != sender) {
        return Err(fdo::Error::AccessDenied(
            "that session belongs to another app".into(),
        ));
    }
    sessions.remove(path);
    Ok(())
}

#[interface(name = "org.freedesktop.Secret.Session")]
impl SessionObject {
    async fn close(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<()> {
        let peer = peer::check(connection, &header).await?;
        forget(&self.shared, &self.path, &peer.sender)?;
        let path = ObjectPath::try_from(self.path.as_str())
            .map_err(|e| fdo::Error::Failed(e.to_string()))?;
        server.remove::<SessionObject, _>(&path).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::session::{Algorithm, Session};

    #[test]
    fn only_the_owner_closes_a_session() {
        let shared = Shared::new("/nonexistent".into());
        let path = "/org/freedesktop/secrets/session/s1";
        shared.sessions.lock().unwrap().insert(
            path.into(),
            Session {
                owner: ":1.10".into(),
                algorithm: Algorithm::Plain,
            },
        );
        assert!(matches!(
            forget(&shared, path, ":1.11"),
            Err(fdo::Error::AccessDenied(_))
        ));
        assert!(shared.sessions.lock().unwrap().contains_key(path));
        forget(&shared, path, ":1.10").unwrap();
        assert!(shared.sessions.lock().unwrap().is_empty());
        // Already gone: nothing left to protect, so its object may go.
        forget(&shared, path, ":1.11").unwrap();
    }
}
