//! `capture-mask`'s params (docs/compositor-ipc.md, "Secrets for agents"):
//! what is blanked in the pictures for one client, read into a `Mask`.

use serde::{Deserialize, Serialize};

use super::mask::Mask;
use crate::{
    ipc::protocol::{Coord, Int, WindowId},
    wm::valid_frame,
};

/// At most this many of each kind.
pub(super) const MAX_ENTRIES: usize = 256;

/// A window the mask names (whole, or its popups).
type Id = Int<0, { i64::MAX }>;
/// A process.
type ProcessId = Int<0, { u32::MAX as i64 }>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaptureMask {
    pub client: String,
    pub windows: Option<Vec<Id>>,
    pub rects: Option<Vec<MaskRect>>,
    pub layers: Option<Vec<String>>,
    pub pids: Option<Vec<ProcessId>>,
    pub popups: Option<Vec<Id>>,
}

/// In a window's content coordinates when `window` is set, else global.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MaskRect {
    pub window: Option<WindowId>,
    pub x: Coord,
    pub y: Coord,
    pub width: Coord,
    pub height: Coord,
}

fn listed<'a, T>(list: &'a Option<Vec<T>>, key: &str) -> Result<&'a [T], String> {
    let list = list.as_deref().unwrap_or_default();
    if list.len() > MAX_ENTRIES {
        return Err(format!("`{key}` must be a list of at most {MAX_ENTRIES}"));
    }
    Ok(list)
}

/// A mask with nothing in it is dropped (by the caller).
pub(crate) fn parse(params: &CaptureMask) -> Result<(String, Mask), String> {
    let client = params.client.clone();
    if client.is_empty() || client.len() > 64 {
        return Err("`client` must name whose captures are masked".into());
    }
    let ids = |list: &Option<Vec<Id>>, key: &str| -> Result<Vec<u64>, String> {
        Ok(listed(list, key)?.iter().map(|id| id.to::<u64>()).collect())
    };
    let layers = listed(&params.layers, "layers")?;
    if layers.iter().any(|layer| layer.len() > 128) {
        return Err("`layers` must be namespaces".into());
    }
    let rects = listed(&params.rects, "rects")?
        .iter()
        .map(|r| {
            let frame = valid_frame(r.x.get(), r.y.get(), r.width.get(), r.height.get())
                .ok_or("a rect needs a positive size")?;
            Ok((r.window.map(|id| id.0), frame))
        })
        .collect::<Result<_, String>>()?;
    Ok((
        client,
        Mask {
            windows: ids(&params.windows, "windows")?,
            rects,
            layers: layers.to_vec(),
            pids: listed(&params.pids, "pids")?
                .iter()
                .map(|pid| pid.to::<u32>())
                .collect(),
            popups: ids(&params.popups, "popups")?,
            kept: Vec::new(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn parse_json(value: Value) -> Result<(String, Mask), String> {
        parse(&crate::ipc::protocol::read(value)?)
    }

    #[test]
    fn masks_parse_and_bad_ones_are_refused() {
        let (client, mask) = parse_json(json!({
            "client": "agent",
            "windows": [3],
            "rects": [{ "window": 3, "x": 10, "y": 20, "width": 200, "height": 30 }, { "x": 0, "y": 0, "width": 5, "height": 5 }],
            "layers": ["dashi.agent-consent"],
            "pids": [4242],
            "popups": [5],
        }))
        .unwrap();
        assert_eq!(client, "agent");
        assert_eq!(mask.windows, vec![3]);
        assert_eq!(mask.rects[0].0, Some(3));
        assert_eq!(mask.rects[1].0, None);
        assert_eq!(mask.pids, vec![4242]);
        assert_eq!(mask.popups, vec![5]);
        assert!(mask.kept.is_empty());
        assert!(parse_json(json!({ "client": "agent", "popups": [-1] })).is_err());
        assert!(parse_json(json!({ "windows": [1] })).is_err());
        assert!(
            parse_json(
                json!({ "client": "agent", "rects": [{ "x": 0, "y": 0, "width": 0, "height": 5 }] })
            )
            .is_err()
        );
        assert!(parse_json(json!({ "client": "agent", "windows": ["w3"] })).is_err());
        let many: Vec<u64> = (0..300).collect();
        assert!(parse_json(json!({ "client": "agent", "windows": many })).is_err());
    }
}
