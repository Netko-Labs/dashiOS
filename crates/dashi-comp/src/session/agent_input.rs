//! `agent-input`'s params (docs/compositor-ipc.md, "Capture and agents"): an
//! agent's pointer or key action into one window, or `{release: true}`. The
//! shell's src/agents/desktop/hands.ts sends them; session/agent.rs runs them.

use serde::{Deserialize, Serialize};

use crate::ipc::protocol::{Count, Finite, Int};

/// `agent-input`'s params: an action into `window` (as `label`), or `{release: true}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentInput {
    #[serde(default)]
    pub release: bool,
    pub window: Option<Int<0, { i64::MAX }>>,
    pub label: Option<String>,
    /// Where, in the window's content coordinates.
    pub pointer: Option<AgentPoint>,
    pub action: Option<PointerAction>,
    pub button: Option<Button>,
    pub scroll: Option<Scroll>,
    pub keys: Option<Vec<KeyStep>>,
    /// Borrow the person's seat once their own input is `idleMs` old.
    pub borrow: Option<Borrow>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentPoint {
    pub x: Finite,
    pub y: Finite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PointerAction {
    #[default]
    Move,
    Click,
    Press,
    Release,
    Scroll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Button {
    #[default]
    Left,
    Right,
    Middle,
}

/// A wheel's scroll in pixels, each way at most 10000 (kept within).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Scroll {
    pub dx: Option<Finite>,
    pub dy: Option<Finite>,
}

/// One step of keys: `text` typed, or the key `name` tapped (or held `down`, let `up`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct KeyStep {
    pub text: Option<String>,
    pub name: Option<String>,
    pub state: Option<KeyMove>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum KeyMove {
    Down,
    Up,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Borrow {
    pub idle_ms: Option<Count>,
}
