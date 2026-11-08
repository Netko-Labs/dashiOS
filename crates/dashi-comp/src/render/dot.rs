//! The privacy dot (`privacy-dot`): a small dot the shell asks for while a
//! camera is in use, drawn by the compositor in the top-right corner of every
//! screen, over everything (full-screen windows and the menu bar included)
//! but the pointer, so no app can cover it. It is drawn on the screens only,
//! never into a capture or a screen share. When it shows and in what color is
//! the shell's (src/camera/); where the menu bar's own item for it sits is the
//! shell's too, which puts it under the dot so a click on it opens the list of
//! who is using the camera.

use serde_json::{Map, Value};
use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            ImportMem, Renderer,
            element::{
                Kind,
                memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
            },
        },
    },
    utils::{Logical, Physical, Point, Rectangle, Scale, Transform},
};

#[derive(Debug, PartialEq, Clone, Copy)]
pub(crate) struct DotSpec {
    pub color: [u8; 3],
    /// From the screen's top-right corner to the dot's, logical.
    pub right: i32,
    pub top: i32,
    /// Its diameter, logical.
    pub size: i32,
}

#[derive(Default)]
pub(crate) struct PrivacyDot {
    spec: Option<DotSpec>,
    /// The dot drawn at a whole-number scale.
    image: Option<(i32, MemoryRenderBuffer)>,
}

fn color(text: &str) -> Option<[u8; 3]> {
    let hex = text.strip_prefix('#').filter(|hex| hex.len() == 6)?;
    let byte = |at: usize| u8::from_str_radix(hex.get(at..at + 2)?, 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// `privacy-dot {color: "#rrggbb" | null, right?, top?, size?}`.
pub(crate) fn parse(params: &Map<String, Value>) -> Result<Option<DotSpec>, String> {
    let shade = match params.get("color") {
        None | Some(Value::Null) => return Ok(None),
        Some(value) => value
            .as_str()
            .and_then(color)
            .ok_or("`color` must be \"#rrggbb\" or null")?,
    };
    let number = |key: &str, default: i64, max: i64| -> Result<i32, String> {
        match params.get(key) {
            None => Ok(default as i32),
            Some(value) => value
                .as_i64()
                .filter(|v| (0..=max).contains(v))
                .map(|v| v as i32)
                .ok_or(format!("`{key}` must be a whole number from 0 to {max}")),
        }
    };
    let size = number("size", 8, 32)?.max(2);
    Ok(Some(DotSpec {
        color: shade,
        right: number("right", 12, 512)?,
        top: number("top", 11, 256)?,
        size,
    }))
}

/// A dot `size` pixels across, antialiased, premultiplied.
fn draw(color: [u8; 3], size: i32) -> Vec<u8> {
    let n = size.max(1) as usize;
    let r = n as f32 / 2.0;
    let mut pixels = vec![0u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = (x as f32 + 0.5 - r, y as f32 + 0.5 - r);
            let a = (r - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
            let at = (y * n + x) * 4;
            let premul = |c: u8| (f32::from(c) * a).round() as u8;
            pixels[at..at + 4].copy_from_slice(&[
                premul(color[0]),
                premul(color[1]),
                premul(color[2]),
                (a * 255.0).round() as u8,
            ]);
        }
    }
    pixels
}

impl PrivacyDot {
    pub(crate) fn set(&mut self, spec: Option<DotSpec>) {
        if self.spec != spec {
            self.image = None;
        }
        self.spec = spec;
    }

    /// The dot on a screen at `screen` (global logical) seen from `origin`, or None when off.
    pub(crate) fn element<R>(
        &mut self,
        renderer: &mut R,
        screen: Rectangle<i32, Logical>,
        origin: Point<i32, Logical>,
        scale: Scale<f64>,
    ) -> Option<MemoryRenderBufferRenderElement<R>>
    where
        R: Renderer + ImportMem,
        R::TextureId: Clone + Send + 'static,
    {
        let spec = self.spec?;
        let whole = scale.x.ceil().max(1.0) as i32;
        if self.image.as_ref().is_none_or(|(s, _)| *s != whole) {
            let side = spec.size * whole;
            let buffer = MemoryRenderBuffer::from_slice(
                &draw(spec.color, side),
                Fourcc::Abgr8888,
                (side, side),
                whole,
                Transform::Normal,
                None,
            );
            self.image = Some((whole, buffer));
        }
        let (_, buffer) = self.image.as_ref()?;
        let at = Point::<i32, Logical>::from((
            screen.loc.x + screen.size.w - spec.right - spec.size,
            screen.loc.y + spec.top,
        ));
        let physical: Point<f64, Physical> = (at - origin).to_f64().to_physical(scale);
        MemoryRenderBufferRenderElement::from_buffer(
            renderer,
            physical,
            buffer,
            None,
            None,
            None,
            Kind::Unspecified,
        )
        .ok()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn the_dot_is_checked() {
        assert_eq!(
            parse(&params(
                json!({ "color": "#30d158", "right": 17, "top": 9, "size": 8 })
            )),
            Ok(Some(DotSpec {
                color: [0x30, 0xd1, 0x58],
                right: 17,
                top: 9,
                size: 8
            }))
        );
        assert_eq!(parse(&params(json!({ "color": null }))), Ok(None));
        assert_eq!(parse(&params(json!({}))), Ok(None));
        for bad in [
            json!({ "color": "green" }),
            json!({ "color": "#30d1" }),
            json!({ "color": "#30d158", "size": 100 }),
            json!({ "color": "#30d158", "right": -1 }),
        ] {
            assert!(parse(&params(bad.clone())).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_dot_is_round_and_premultiplied() {
        let pixels = draw([0x30, 0xd1, 0x58], 8);
        let at = |x: usize, y: usize| &pixels[(y * 8 + x) * 4..(y * 8 + x) * 4 + 4];
        assert_eq!(at(4, 4), &[0x30, 0xd1, 0x58, 255], "solid in the middle");
        assert_eq!(at(0, 0)[3], 0, "clear in the corner");
        assert!(
            at(0, 4)[3] > 0 && at(0, 4)[1] <= at(0, 4)[3],
            "premultiplied at the edge"
        );
    }
}
