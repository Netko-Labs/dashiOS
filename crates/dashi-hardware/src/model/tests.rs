//! Model matching, recipes and the installed database.

use std::path::Path;

use serde_json::Value;

use super::{Dmi, Model, find, load_all};

fn dmi(pairs: &[(&'static str, &str)]) -> Dmi {
    Dmi {
        fields: pairs.iter().map(|(k, v)| (*k, (*v).to_owned())).collect(),
    }
}

fn ga403wr() -> Model {
    let text = include_str!("../../../../data/models/GA403WR.json");
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
    let bare =
        Model::parse(r#"{"id": "X", "name": "X", "match": {"board_name": "X"}}"#).expect("parses");
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
