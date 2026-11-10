//! What the vault holds, inside its sealed body: Secret Service collections
//! and items (apps' secrets), logins (a site, an account, a password, maybe a
//! TOTP secret), the portal's per-app secrets, cards, and API tokens. Secrets
//! are `Secret`, so none of this prints one.

mod collection;
mod data;
mod login;
mod passkey;
mod payment;
mod site;

pub use collection::{Collection, SecretItem};
pub use data::Data;
pub use login::{AgentUse, Login, LoginSummary, Totp, TotpAlgorithm};
pub use passkey::Passkey;
pub use payment::{Card, Payment, Spending};
pub use site::{normalize_site, site_matches};
