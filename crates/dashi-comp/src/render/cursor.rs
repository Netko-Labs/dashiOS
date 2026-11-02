//! The pointer's image: the client's own surface when it sets one, else a
//! named icon from the xcursor theme (`XCURSOR_THEME`, `XCURSOR_SIZE`), else a
//! plain arrow drawn here. Loading follows smithay's anvil example (MIT).

use std::collections::HashMap;

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::{Logical, Point, Transform},
};
use xcursor::{CursorTheme, parser::parse_xcursor};

use super::canvas::{Canvas, Rgba};

/// A cursor image and where its hot spot is, in logical pixels.
#[derive(Clone)]
pub(crate) struct CursorImage {
    pub buffer: MemoryRenderBuffer,
    pub hotspot: Point<i32, Logical>,
}

pub(crate) struct Cursors {
    theme: CursorTheme,
    size: u32,
    cache: HashMap<(String, i32), CursorImage>,
}

impl Default for Cursors {
    fn default() -> Self {
        let name = std::env::var("XCURSOR_THEME").unwrap_or_else(|_| "default".into());
        let size = std::env::var("XCURSOR_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(24);
        Self {
            theme: CursorTheme::load(&name),
            size,
            cache: HashMap::new(),
        }
    }
}

impl Cursors {
    /// The image for icon `name` at `scale`, falling back to the default arrow.
    pub(crate) fn get(&mut self, name: &str, scale: i32) -> CursorImage {
        let key = (name.to_owned(), scale);
        if let Some(image) = self.cache.get(&key) {
            return image.clone();
        }
        let image = self
            .load(name, scale)
            .or_else(|| self.load("default", scale))
            .or_else(|| self.load("left_ptr", scale))
            .unwrap_or_else(|| arrow(scale));
        self.cache.insert(key, image.clone());
        image
    }

    fn load(&self, name: &str, scale: i32) -> Option<CursorImage> {
        let path = self.theme.load_icon(name)?;
        let data = std::fs::read(path).ok()?;
        let images = parse_xcursor(&data)?;
        let want = self.size as i32 * scale;
        let image = images
            .iter()
            .min_by_key(|image| (image.size as i32 - want).abs())?;
        // xcursor images are in nominal pixels: shown at `scale`, as a buffer of that scale.
        let buffer_scale = (image.size as i32 / self.size as i32).max(1);
        let buffer = MemoryRenderBuffer::from_slice(
            &image.pixels_rgba,
            Fourcc::Abgr8888,
            (image.width as i32, image.height as i32),
            buffer_scale,
            Transform::Normal,
            None,
        );
        let hotspot = Point::from((
            image.xhot as i32 / buffer_scale,
            image.yhot as i32 / buffer_scale,
        ));
        Some(CursorImage { buffer, hotspot })
    }
}

/// A plain arrow, for systems without a cursor theme.
fn arrow(scale: i32) -> CursorImage {
    let s = scale.max(1);
    let mut canvas = Canvas::new(16 * s, 24 * s);
    for y in 0..canvas.height {
        let row = y as f32 / s as f32;
        let reach = (row * 0.62).min(11.0);
        for x in 0..canvas.width {
            let col = x as f32 / s as f32;
            if row < 18.0 && col <= reach {
                let edge = col >= reach - 1.2 || col < 1.2;
                canvas.blend(
                    x,
                    y,
                    if edge {
                        Rgba::hex(0xffffff)
                    } else {
                        Rgba::hex(0x000000)
                    },
                    1.0,
                );
            }
        }
    }
    let buffer = MemoryRenderBuffer::from_slice(
        &canvas.pixels,
        Fourcc::Abgr8888,
        (canvas.width, canvas.height),
        s,
        Transform::Normal,
        None,
    );
    CursorImage {
        buffer,
        hotspot: Point::from((1, 1)),
    }
}

/// The agent's pointer: a violet arrow and the agent's name beside it.
pub(crate) fn agent_pointer(
    label: &str,
    scale: i32,
    text: &mut super::text::Text,
) -> MemoryRenderBuffer {
    let s = scale.max(1);
    let label_w = 14 + 7 * label.chars().count().min(40) as i32;
    let mut canvas = Canvas::new((18 + label_w) * s, 26 * s);
    let violet = Rgba::hex(0x8b5cf6);
    for y in 0..18 * s {
        let row = y as f32 / s as f32;
        let reach = (row * 0.62).min(11.0);
        for x in 0..12 * s {
            let col = x as f32 / s as f32;
            if col <= reach {
                let edge = col >= reach - 1.2 || col < 1.2;
                canvas.blend(x, y, if edge { Rgba::hex(0xffffff) } else { violet }, 1.0);
            }
        }
    }
    // The name in a pill below and to the right of the tip.
    for y in 12 * s..26 * s {
        for x in 14 * s..canvas.width {
            canvas.blend(x, y, violet, 0.92);
        }
    }
    let mut pill = Canvas::new(label_w * s, 14 * s);
    text.draw_centered(
        &mut pill,
        label,
        10.0 * s as f32,
        Rgba::hex(0xffffff),
        4 * s,
        label_w * s - 4 * s,
    );
    for y in 0..pill.height {
        for x in 0..pill.width {
            let at = ((y * pill.width + x) * 4) as usize;
            let alpha = pill.pixels[at + 3];
            if alpha > 0 {
                canvas.blend(
                    14 * s + x + 2 * s,
                    12 * s + y,
                    Rgba::hex(0xffffff),
                    f32::from(alpha) / 255.0,
                );
            }
        }
    }
    MemoryRenderBuffer::from_slice(
        &canvas.pixels,
        Fourcc::Abgr8888,
        (canvas.width, canvas.height),
        s,
        Transform::Normal,
        None,
    )
}
