use serde_json::{Value, json};

use super::*;
use crate::ipc::protocol::read;

/// Frost's numbers in Light (theme/glass.ts), as the shell sends them; the IPC fixture too.
pub(crate) fn example(mode: &str) -> Value {
    let level = |blur: f64, saturation: f64, tint: &str, solid: Option<&str>| json!({ "blur": blur, "saturation": saturation, "tint": tint, "solid": solid });
    json!({
        "mode": mode,
        "levels": {
            "thin": level(18.0, 1.8, "#f6f6f870", Some("#ececef")),
            "regular": level(30.0, 1.6, "#f8f8fa9e", Some("#f7f7f9")),
            "thick": level(44.0, 1.4, "#eeeef2b8", Some("#e8e8ec")),
            "paper": level(30.0, 1.4, "#fbfbf9a3", Some("#fbfbf9")),
            "veil": level(10.0, 1.15, "#f6f6f81f", None),
        },
        "grain": 0.035,
        "rim": { "width": 1, "top": "#ffffffd9", "middle": "#ffffff59", "bottom": "#ffffff26" },
        "hairline": { "width": 0.5, "color": "#0000001a" },
        "floor": { "ink": "#5d5d63", "ratio": 4.65 },
        "depth": 2,
        "apps": "regular",
    })
}

fn style(mode: &str) -> Style {
    parse(&read::<GlassStyleParams>(example(mode)).unwrap()).unwrap()
}

#[test]
fn each_level_takes_its_own_numbers_and_the_shared_ones() {
    let style = style("frosted");
    let thin = style.look(Level::Thin, 10.0).unwrap();
    assert_eq!((thin.blur, thin.radius), (18.0, 10.0));
    assert!((thin.saturation - 1.8).abs() < 1e-6);
    // Premultiplied, its α the least the floor starts from.
    assert!((thin.tint[3] - 0x70 as f32 / 255.0).abs() < 1e-4);
    assert!((thin.noise - 0.035).abs() < 1e-6);
    assert_eq!(thin.rim.0, 1.0);
    assert_eq!(thin.keel.0, 0.5);
    assert!(thin.floor[1] > 4.6);
    // Frosted: not solid, not x-ray.
    assert_eq!(thin.solid, None);
    assert!(!thin.xray);
    assert_eq!(style.look(Level::Thick, 0.0).unwrap().blur, 44.0);
}

#[test]
fn battery_saver_sees_the_wallpaper_and_reduce_transparency_goes_solid() {
    let xray = style("xray").look(Level::Regular, 14.0).unwrap();
    assert!(xray.xray && xray.solid.is_none());
    let solid = style("solid");
    let regular = solid.look(Level::Regular, 14.0).unwrap();
    let [r, g, b] = regular.solid.unwrap();
    assert!((r - 0xf7 as f32 / 255.0).abs() < 1e-4 && g > 0.9 && b > 0.9);
    // The rim and hairline stay (GL-3); the veil has no twin and is not drawn.
    assert_eq!(regular.rim.0, 1.0);
    assert_eq!(solid.look(Level::Veil, 0.0), None);
}

#[test]
fn an_apps_region_borrows_a_blur_and_nothing_else() {
    let look = style("frosted").app_look().unwrap();
    assert_eq!(look.blur, 30.0);
    assert_eq!(look.tint, [0.0; 4]);
    assert_eq!(look.rim.0, 0.0);
    assert_eq!(look.keel.0, 0.0);
    assert_eq!(look.floor, [0.0; 2]);
    // Solid: the app's own fill shows, nothing is drawn under it.
    assert_eq!(style("solid").app_look(), None);
}

#[test]
fn lengths_scale_to_the_screen() {
    let look = style("frosted")
        .look(Level::Regular, 10.0)
        .unwrap()
        .scaled(1.75);
    assert_eq!((look.radius, look.blur), (17.5, 52.5));
    assert_eq!((look.rim.0, look.keel.0), (1.75, 0.875));
}

#[test]
fn levels_come_off_the_wire_in_order() {
    assert_eq!(Level::from_wire(0), Some(Level::Thin));
    assert_eq!(Level::from_wire(4), Some(Level::Veil));
    assert_eq!(Level::from_wire(5), None);
}

#[test]
fn bad_styles_change_nothing() {
    let mut bad = example("frosted");
    bad["levels"]["thin"]["tint"] = json!("white");
    assert!(parse(&read::<GlassStyleParams>(bad).unwrap()).is_err());
    let mut bad = example("frosted");
    bad["mode"] = json!("sparkly");
    assert!(read::<GlassStyleParams>(bad).is_err());
    let mut bad = example("frosted");
    bad["depth"] = json!(0);
    assert!(read::<GlassStyleParams>(bad).is_err());
}
