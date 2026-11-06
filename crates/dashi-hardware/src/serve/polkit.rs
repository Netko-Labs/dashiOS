//! The polkit check: before a privileged method runs, ask
//! `org.freedesktop.PolicyKit1` whether the calling session may perform the
//! action (`dev.dashi.hardware.everyday`, allow_active; or
//! `dev.dashi.hardware.tune`, auth_admin_keep). On a fake tree (the session
//! bus) there is no system polkit, so everything is allowed.

use std::collections::HashMap;

use zbus::proxy;
use zbus::zvariant::Value;

use crate::knobs::Action;

#[proxy(
    interface = "org.freedesktop.PolicyKit1.Authority",
    default_service = "org.freedesktop.PolicyKit1",
    default_path = "/org/freedesktop/PolicyKit1/Authority"
)]
trait Authority {
    #[allow(clippy::type_complexity)]
    fn check_authorization(
        &self,
        subject: &(&str, HashMap<&str, Value<'_>>),
        action_id: &str,
        details: HashMap<&str, &str>,
        flags: u32,
        cancellation_id: &str,
    ) -> zbus::Result<(bool, bool, HashMap<String, String>)>;
}

/// Allow a caller `sender` (its unique bus name) to perform `action`, asking
/// polkit, letting it prompt for a password where the action needs one
/// (AllowUserInteraction). `fake` skips the check.
pub(crate) async fn allowed(
    connection: &zbus::Connection,
    sender: Option<&str>,
    action: Action,
    fake: bool,
) -> Result<bool, String> {
    if fake {
        return Ok(true);
    }
    let Some(sender) = sender else {
        return Ok(false);
    };
    let authority = AuthorityProxy::new(connection)
        .await
        .map_err(|e| e.to_string())?;
    let mut subject_details: HashMap<&str, Value<'_>> = HashMap::new();
    subject_details.insert("name", Value::from(sender));
    let subject = ("system-bus-name", subject_details);
    const ALLOW_USER_INTERACTION: u32 = 0x1;
    let (authorized, _challenge, _details) = authority
        .check_authorization(
            &subject,
            action.id(),
            HashMap::new(),
            ALLOW_USER_INTERACTION,
            "",
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(authorized)
}
