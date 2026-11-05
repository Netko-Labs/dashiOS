//! Applets' processes and their layer-shell grants (`applet-clients`,
//! docs/compositor-ipc.md). The shell names every process that runs an
//! applet; a Wayland client under one of them may open layer surfaces only
//! while the shell grants it (an open popover, docs/applets.md), and its
//! layer surfaces close when the grant goes. Who gets one is the shell's
//! decision; this only carries it out. Clients under no applet are as before.

use serde_json::{Map, Value};

use super::trust::descends_from;

/// The most processes one request may name.
pub(crate) const MAX_APPLETS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AppletClient {
    pub pid: i32,
    pub layer_shell: bool,
}

#[derive(Default)]
pub(crate) struct AppletClients {
    list: Vec<AppletClient>,
}

impl AppletClients {
    /// `{applets: [{pid, layerShell}]}`, all of it or nothing.
    pub(crate) fn parse(params: &Map<String, Value>) -> Result<Vec<AppletClient>, String> {
        let applets = params
            .get("applets")
            .and_then(Value::as_array)
            .ok_or("`applets` must be a list")?;
        if applets.len() > MAX_APPLETS {
            return Err(format!("`applets` names more than {MAX_APPLETS} processes"));
        }
        applets
            .iter()
            .map(|entry| {
                let pid = entry
                    .get("pid")
                    .and_then(Value::as_i64)
                    .filter(|pid| (2..=i64::from(i32::MAX)).contains(pid))
                    .ok_or("each applet needs a `pid`, a process id above 1")?;
                let layer_shell = entry
                    .get("layerShell")
                    .and_then(Value::as_bool)
                    .ok_or("each applet needs `layerShell`: true or false")?;
                Ok(AppletClient {
                    pid: pid as i32,
                    layer_shell,
                })
            })
            .collect()
    }

    pub(crate) fn set(&mut self, list: Vec<AppletClient>) {
        self.list = list;
    }

    /// The applet a process runs under, if any.
    pub(crate) fn applet_of(&self, pid: i32) -> Option<AppletClient> {
        self.list
            .iter()
            .copied()
            .find(|applet| descends_from(pid, applet.pid))
    }

    /// Whether a client (by its pid, None when unknown) may open a layer surface.
    pub(crate) fn may_use_layer_shell(&self, pid: Option<i32>) -> bool {
        match pid {
            None => true,
            Some(pid) => self.applet_of(pid).is_none_or(|applet| applet.layer_shell),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn the_list_is_checked_whole() {
        let good = params(
            json!({"applets": [{"pid": 4242, "layerShell": true}, {"pid": 4300, "layerShell": false}]}),
        );
        assert_eq!(
            AppletClients::parse(&good),
            Ok(vec![
                AppletClient {
                    pid: 4242,
                    layer_shell: true
                },
                AppletClient {
                    pid: 4300,
                    layer_shell: false
                },
            ])
        );
        for bad in [
            json!({}),
            json!({"applets": [{"pid": 1, "layerShell": true}]}),
            json!({"applets": [{"pid": -5, "layerShell": true}]}),
            json!({"applets": [{"pid": 4242}]}),
            json!({"applets": [{"pid": "4242", "layerShell": true}]}),
        ] {
            assert!(AppletClients::parse(&params(bad)).is_err());
        }
        let many: Vec<Value> = (0..=MAX_APPLETS)
            .map(|n| json!({"pid": 1000 + n, "layerShell": false}))
            .collect();
        assert!(AppletClients::parse(&params(json!({ "applets": many }))).is_err());
    }

    #[test]
    fn a_process_under_an_applet_needs_its_grant() {
        let me = std::process::id() as i32;
        let mut clients = AppletClients::default();
        assert!(clients.may_use_layer_shell(Some(me)));
        clients.set(vec![AppletClient {
            pid: me,
            layer_shell: false,
        }]);
        assert!(!clients.may_use_layer_shell(Some(me)));
        assert!(clients.may_use_layer_shell(Some(i32::MAX)));
        clients.set(vec![AppletClient {
            pid: me,
            layer_shell: true,
        }]);
        assert!(clients.may_use_layer_shell(Some(me)));
    }
}
