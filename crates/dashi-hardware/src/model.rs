//! The model database (`data/models/*.json`, installed to
//! `/usr/share/dashi/models/`): what the kernel can't say about a machine,
//! matched on DMI. Schema: `data/models/schema.json`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::sysfs::Sysfs;

pub(crate) const INSTALLED_MODELS: &str = "/usr/share/dashi/models";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Model {
    pub(crate) id: String,
    #[serde(rename = "match")]
    pub(crate) matches: Matches,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) fans: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) limits: BTreeMap<String, [u32; 2]>,
    pub(crate) undervolt: Option<Undervolt>,
    pub(crate) hotkeys: Option<Value>,
    pub(crate) lighting: Option<Lighting>,
    #[serde(default)]
    pub(crate) quirks: Vec<String>,
    pub(crate) recipes: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum Matches {
    One(BTreeMap<String, String>),
    Any(Vec<BTreeMap<String, String>>),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Undervolt {
    pub(crate) cpu: [i32; 2],
    #[serde(default)]
    pub(crate) per_core: bool,
    /// Whether the graphics has its own offset (Strix Point has none). The
    /// helper has no graphics-offset path yet; carried for the model.
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) graphics: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct Lighting {
    pub(crate) keyboard: Option<KeyboardLight>,
    pub(crate) slash: Option<UsbLight>,
    pub(crate) anime: Option<UsbLight>,
    pub(crate) aura: Option<UsbLight>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct KeyboardLight {
    pub(crate) levels: Option<u32>,
    #[serde(default)]
    pub(crate) rgb: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct UsbLight {
    /// The lid light's USB id (`0b05:19b6`). Carried for asusd and the shell;
    /// the helper only reports that the light exists.
    #[allow(dead_code)]
    pub(crate) usb: String,
}

/// The DMI fields a model can match on, read once.
#[derive(Clone, Debug, Default)]
pub(crate) struct Dmi {
    pub(crate) fields: BTreeMap<&'static str, String>,
}

const DMI_FIELDS: [&str; 4] = ["sys_vendor", "product_name", "board_name", "product_family"];

impl Dmi {
    pub(crate) fn read(sysfs: &Sysfs) -> Self {
        let fields = DMI_FIELDS
            .iter()
            .filter_map(|field| Some((*field, sysfs.read(&format!("class/dmi/id/{field}"))?)))
            .collect();
        Self { fields }
    }

    pub(crate) fn get(&self, field: &str) -> Option<&str> {
        self.fields.get(field).map(String::as_str)
    }
}

impl Model {
    /// Whether one recipe column (a mode, plugged in or on battery) gives
    /// every knob in `values` exactly that value. Recipes ship in the
    /// root-owned model database, so a mode switch that writes them writes
    /// only values Dashi chose for this machine.
    pub(crate) fn recipe_gives(&self, values: &[(&str, Value)]) -> bool {
        let Some(Value::Object(modes)) = &self.recipes else {
            return false;
        };
        modes
            .values()
            .filter_map(Value::as_object)
            .flat_map(|columns| columns.values().filter_map(Value::as_object))
            .any(|column| {
                values
                    .iter()
                    .all(|(knob, value)| column.get(*knob) == Some(value))
            })
    }

    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let model: Model = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let rules = model.match_rules();
        if rules.is_empty() || rules.iter().any(|rule| rule.is_empty()) {
            return Err("match needs at least one DMI field".into());
        }
        if let Some(rule) = rules
            .iter()
            .flat_map(|rule| rule.keys())
            .find(|key| !DMI_FIELDS.contains(&key.as_str()))
        {
            return Err(format!("match: unknown DMI field {rule}"));
        }
        if let Some(undervolt) = &model.undervolt
            && undervolt.cpu[0] > undervolt.cpu[1]
        {
            return Err("undervolt.cpu: min above max".into());
        }
        if let Some((knob, _)) = model.limits.iter().find(|(_, [min, max])| min > max) {
            return Err(format!("limits.{knob}: min above max"));
        }
        Ok(model)
    }

    fn match_rules(&self) -> Vec<&BTreeMap<String, String>> {
        match &self.matches {
            Matches::One(rule) => vec![rule],
            Matches::Any(rules) => rules.iter().collect(),
        }
    }

    /// Whether this model is the machine `dmi` describes.
    pub(crate) fn matches(&self, dmi: &Dmi) -> bool {
        self.match_rules().iter().any(|rule| {
            rule.iter().all(|(field, wanted)| {
                dmi.get(field)
                    .is_some_and(|actual| value_matches(wanted, actual))
            })
        })
    }

    /// The narrowed range for a numeric knob, if the model gives one.
    pub(crate) fn limit(&self, knob: &str) -> Option<(u32, u32)> {
        self.limits.get(knob).map(|[min, max]| (*min, *max))
    }
}

fn value_matches(wanted: &str, actual: &str) -> bool {
    match wanted.strip_suffix('*') {
        Some(prefix) => actual.starts_with(prefix),
        None => wanted == actual,
    }
}

/// Every model in `dir`, skipping (and reporting) files that don't parse.
pub(crate) fn load_all(dir: &Path) -> Vec<Model> {
    let mut models = Vec::new();
    let mut names: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    names.sort();
    for path in names {
        let is_model = path.extension().is_some_and(|ext| ext == "json")
            && path.file_name().is_some_and(|name| name != "schema.json");
        if !is_model {
            continue;
        }
        match fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| Model::parse(&text))
        {
            Ok(model) => models.push(model),
            Err(error) => eprintln!("dashi-hardware: {}: {error}", path.display()),
        }
    }
    models
}

/// The first model in `dir` that matches this machine.
pub(crate) fn find(dir: &Path, dmi: &Dmi) -> Option<Model> {
    load_all(dir).into_iter().find(|model| model.matches(dmi))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dmi(pairs: &[(&'static str, &str)]) -> Dmi {
        Dmi {
            fields: pairs.iter().map(|(k, v)| (*k, (*v).to_owned())).collect(),
        }
    }

    fn ga403wr() -> Model {
        let text = include_str!("../../../data/models/GA403WR.json");
        Model::parse(text).expect("GA403WR.json parses")
    }

    #[test]
    fn the_g14_matches_its_dmi() {
        let model = ga403wr();
        let g14 = dmi(&[
            ("sys_vendor", "ASUSTeK COMPUTER INC."),
            ("product_name", "ROG Zephyrus G14 GA403WR_GA403WR"),
            ("board_name", "GA403WR"),
        ]);
        assert!(model.matches(&g14));
        assert_eq!(model.undervolt.as_ref().map(|u| u.cpu), Some([-40, 0]));
        assert_eq!(model.limit("charge-limit"), Some((20, 100)));
    }

    #[test]
    fn a_recipe_column_gives_its_own_values_and_nothing_else() {
        let model = ga403wr();
        // Balanced on battery and Low Power plugged in both give 30 W.
        assert!(model.recipe_gives(&[("ppt-spl", Value::from(30))]));
        assert!(model.recipe_gives(&[
            ("ppt-spl", Value::from(80)),
            ("epp", Value::from("performance"))
        ]));
        // 80 W is Performance plugged in, never with Balanced's processor preference.
        assert!(!model.recipe_gives(&[
            ("ppt-spl", Value::from(80)),
            ("epp", Value::from("balance_power"))
        ]));
        assert!(!model.recipe_gives(&[("ppt-spl", Value::from(81))]));
        assert!(!model.recipe_gives(&[("nv-tgp", Value::from(80))]));
        let bare = Model::parse(r#"{"id": "X", "name": "X", "match": {"board_name": "X"}}"#)
            .expect("parses");
        assert!(!bare.recipe_gives(&[("ppt-spl", Value::from(30))]));
    }

    #[test]
    fn another_board_or_vendor_does_not_match() {
        let model = ga403wr();
        assert!(!model.matches(&dmi(&[
            ("sys_vendor", "ASUSTeK COMPUTER INC."),
            ("board_name", "GA403UV"),
        ])));
        assert!(!model.matches(&dmi(&[("sys_vendor", "LENOVO"), ("board_name", "GA403WR")])));
        assert!(!model.matches(&dmi(&[("board_name", "GA403WR")])));
    }

    #[test]
    fn a_trailing_star_matches_a_prefix_and_lists_match_any() {
        let model = Model::parse(
            r#"{"id": "X", "name": "X", "match": [
                {"sys_vendor": "LENOVO", "product_name": "21K*"},
                {"board_name": "GA403WR"}
            ]}"#,
        )
        .expect("parses");
        assert!(model.matches(&dmi(&[
            ("sys_vendor", "LENOVO"),
            ("product_name", "21KV0011")
        ])));
        assert!(!model.matches(&dmi(&[("sys_vendor", "LENOVO"), ("product_name", "20KV")])));
        assert!(model.matches(&dmi(&[("board_name", "GA403WR")])));
    }

    #[test]
    fn bad_entries_are_refused() {
        assert!(Model::parse(r#"{"id": "X", "name": "X", "match": {}}"#).is_err());
        assert!(Model::parse(r#"{"id": "X", "name": "X", "match": {"serial": "1"}}"#).is_err());
        assert!(
            Model::parse(
                r#"{"id": "X", "name": "X", "match": {"board_name": "A"}, "undervolt": {"cpu": [0, -40]}}"#
            )
            .is_err()
        );
    }

    #[test]
    fn the_installed_tree_loads_and_finds_the_g14() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/models");
        let all = load_all(&dir);
        assert!(all.iter().any(|m| m.id == "GA403WR"));
        let found = find(
            &dir,
            &dmi(&[
                ("sys_vendor", "ASUSTeK COMPUTER INC."),
                ("board_name", "GA403WR"),
            ]),
        );
        assert_eq!(found.map(|m| m.id), Some("GA403WR".to_owned()));
    }
}
