//! The pointer's image: the client's own surface when it sets one, else a
//! named icon from the xcursor theme (`XCURSOR_THEME`), else a plain arrow
//! drawn here. Its size is logical pixels: `XCURSOR_SIZE` at start, then the
//! shell's (IPC `cursor-size`, Settings → Appearance → Pointer size). A theme
//! has a few sizes (Adwaita: 24, 30, 36, 48, 72, 96); the nearest one at least
//! as big as the screen needs is resampled to exactly that, so the pointer is
//! the same size on every screen and at every scale. Loading follows
//! smithay's anvil example (MIT).

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

    /// The pointer's size, in logical pixels; forgets the images of the old one.
    pub(crate) fn set_size(&mut self, size: u32) {
        if self.size != size {
            self.size = size;
            self.cache.clear();
        }
    }

    fn load(&self, name: &str, scale: i32) -> Option<CursorImage> {
        let path = self.theme.load_icon(name)?;
        let data = std::fs::read(path).ok()?;
        let images = parse_xcursor(&data)?;
        let scale = scale.max(1);
        let want = self.size * scale as u32;
        // The smallest image at least as big as wanted (shrinking stays
        // sharp), else the biggest there is. The first frame of an animation.
        let image = images
            .iter()
            .filter(|image| image.size >= want)
            .min_by_key(|image| image.size)
            .or_else(|| images.iter().max_by_key(|image| image.size))?;
        let ratio = want as f32 / image.size.max(1) as f32;
        let (width, height) = (
            ((image.width as f32 * ratio).round() as u32).max(1),
            ((image.height as f32 * ratio).round() as u32).max(1),
        );
        let pixels = if (width, height) == (image.width, image.height) {
            image.pixels_rgba.clone()
        } else {
            resample(
                &image.pixels_rgba,
                (image.width, image.height),
                (width, height),
            )
        };
        let buffer = MemoryRenderBuffer::from_slice(
            &pixels,
            Fourcc::Abgr8888,
            (width as i32, height as i32),
            scale,
            Transform::Normal,
            None,
        );
        let hotspot = Point::from((
            (image.xhot as f32 * ratio / scale as f32).round() as i32,
            (image.yhot as f32 * ratio / scale as f32).round() as i32,
        ));
        Some(CursorImage { buffer, hotspot })
    }
}

/// Resize premultiplied RGBA pixels from `from` to `to`: each new pixel is the
/// area-weighted mean of the old ones it covers (a box filter, which keeps a
/// shrunk arrow's edges smooth; growing blends at most two pixels a side).
fn resample(pixels: &[u8], from: (u32, u32), to: (u32, u32)) -> Vec<u8> {
    let (sw, sh) = from;
    let (dw, dh) = to;
    let fx = sw as f32 / dw as f32;
    let fy = sh as f32 / dh as f32;
    let mut out = vec![0u8; (dw * dh * 4) as usize];
    for dy in 0..dh {
        let (y0, y1) = (dy as f32 * fy, (dy + 1) as f32 * fy);
        for dx in 0..dw {
            let (x0, x1) = (dx as f32 * fx, (dx + 1) as f32 * fx);
            let mut sum = [0f32; 4];
            let mut area = 0f32;
            for sy in (y0.floor() as u32)..(y1.ceil() as u32).min(sh) {
                let wy = y1.min(sy as f32 + 1.0) - y0.max(sy as f32);
                for sx in (x0.floor() as u32)..(x1.ceil() as u32).min(sw) {
                    let weight = wy * (x1.min(sx as f32 + 1.0) - x0.max(sx as f32));
                    if weight <= 0.0 {
                        continue;
                    }
                    let at = ((sy * sw + sx) * 4) as usize;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total +=
                            f32::from(pixels.get(at + channel).copied().unwrap_or(0)) * weight;
                    }
                    area += weight;
                }
            }
            let at = ((dy * dw + dx) * 4) as usize;
            for (channel, total) in sum.iter().enumerate() {
                out[at + channel] =
                    (total / area.max(f32::EPSILON)).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
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

#[cfg(test)]
mod tests {
    use super::resample;

    #[test]
    fn resampling_averages_what_each_pixel_covers() {
        // Two by two to one: the mean of the four.
        let pixels = [
            0, 0, 0, 0, 255, 255, 255, 255, //
            255, 255, 255, 255, 0, 0, 0, 0,
        ];
        assert_eq!(resample(&pixels, (2, 2), (1, 1)), vec![128, 128, 128, 128]);
        // 48 to 36 (a 24 px pointer at 1.5 from Adwaita's 48): opaque stays opaque.
        let opaque = vec![255u8; 48 * 48 * 4];
        let shrunk = resample(&opaque, (48, 48), (36, 36));
        assert_eq!(shrunk.len(), 36 * 36 * 4);
        assert!(shrunk.iter().all(|&value| value == 255));
        // Growing keeps the size asked for.
        assert_eq!(resample(&opaque[..4], (1, 1), (3, 2)).len(), 3 * 2 * 4);
    }
}
