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

/// The agent's pointer is drawn this many points up and left of where it
/// points, so the arrow's white edge and shadow fit around the tip.
pub(crate) const AGENT_TIP: f64 = 2.0;

/// The arrow's outline in points, the tip at (0, 0): the shape of the Mac's pointer.
const ARROW: [(f32, f32); 7] = [
    (0.0, 0.0),
    (0.0, 16.5),
    (4.1, 12.8),
    (6.7, 18.6),
    (9.2, 17.5),
    (6.7, 11.9),
    (11.8, 11.9),
];
const VIOLET: Rgba = Rgba(0x7c, 0x3a, 0xed, 255);
/// The white edge around the arrow, in points.
const EDGE: f32 = 1.3;
/// Samples per pixel side.
const SAMPLES: i32 = 4;

/// Whether (x, y) is inside `shape` (even-odd).
fn inside(shape: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut odd = false;
    let mut j = shape.len() - 1;
    for i in 0..shape.len() {
        let ((xi, yi), (xj, yj)) = (shape[i], shape[j]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            odd = !odd;
        }
        j = i;
    }
    odd
}

/// How far (x, y) is from `shape`'s outline.
fn edge_distance(shape: &[(f32, f32)], x: f32, y: f32) -> f32 {
    let mut best = f32::MAX;
    let mut j = shape.len() - 1;
    for i in 0..shape.len() {
        let ((ax, ay), (bx, by)) = (shape[j], shape[i]);
        let (dx, dy) = (bx - ax, by - ay);
        let t = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(f32::EPSILON))
            .clamp(0.0, 1.0);
        best = best.min(((x - ax - t * dx).powi(2) + (y - ay - t * dy).powi(2)).sqrt());
        j = i;
    }
    best
}

/// How much of a rounded rectangle (points) covers the pixel centered at (x, y) (points), `s` pixels a point.
fn rounded_cover(x: f32, y: f32, rect: (f32, f32, f32, f32), radius: f32, s: f32) -> f32 {
    let (left, top, width, height) = rect;
    let (hx, hy) = (width / 2.0 - radius, height / 2.0 - radius);
    let (qx, qy) = (
        (x - left - width / 2.0).abs() - hx,
        (y - top - height / 2.0).abs() - hy,
    );
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - radius;
    (0.5 - outside * s).clamp(0.0, 1.0)
}

/// The agent's pointer: a violet arrow with a white edge and a soft shadow,
/// and the agent's name in a pill below and to the right of it, clear of the tip.
pub(crate) fn agent_pointer(
    label: &str,
    scale: i32,
    text: &mut super::text::Text,
) -> MemoryRenderBuffer {
    let s = scale.max(1) as f32;
    let tip = AGENT_TIP as f32;
    let font = 11.0;
    let label: String = label.chars().take(40).collect();
    let text_width = text.width(&label, font * s) / s;
    let pill = (tip + 10.0, tip + 19.0, text_width.ceil() + 16.0, 18.0);
    let width = pill.0 + pill.2 + 3.0;
    let height = pill.1 + pill.3 + 3.0;
    let mut canvas = Canvas::new((width * s).ceil() as i32, (height * s).ceil() as i32);
    let sample = |x: i32, y: i32, i: i32, j: i32| {
        (
            (x as f32 + (i as f32 + 0.5) / SAMPLES as f32) / s - tip,
            (y as f32 + (j as f32 + 0.5) / SAMPLES as f32) / s - tip,
        )
    };
    let per_pixel = (SAMPLES * SAMPLES) as f32;
    for y in 0..canvas.height {
        for x in 0..canvas.width {
            let (mut shadow, mut edge, mut fill) = (0.0, 0.0, 0.0);
            for j in 0..SAMPLES {
                for i in 0..SAMPLES {
                    let (px, py) = sample(x, y, i, j);
                    let (sx, sy) = (px - 0.6, py - 1.2);
                    if inside(&ARROW, sx, sy) || edge_distance(&ARROW, sx, sy) < EDGE + 0.8 {
                        shadow += 1.0;
                    }
                    let within = inside(&ARROW, px, py);
                    let distance = edge_distance(&ARROW, px, py);
                    if within || distance < EDGE {
                        edge += 1.0;
                    }
                    if within && distance >= EDGE {
                        fill += 1.0;
                    }
                }
            }
            canvas.blend(x, y, Rgba(0, 0, 0, 255), 0.22 * shadow / per_pixel);
            canvas.blend(x, y, Rgba::hex(0xffffff), edge / per_pixel);
            canvas.blend(x, y, VIOLET, fill / per_pixel);
            // The name's pill, with a faint shadow under it.
            let (cx, cy) = ((x as f32 + 0.5) / s, (y as f32 + 0.5) / s);
            let shade = (pill.0, pill.1 + 1.0, pill.2, pill.3);
            canvas.blend(
                x,
                y,
                Rgba(0, 0, 0, 255),
                0.18 * rounded_cover(cx, cy, shade, pill.3 / 2.0, s),
            );
            canvas.blend(x, y, VIOLET, rounded_cover(cx, cy, pill, pill.3 / 2.0, s));
        }
    }
    let mut words = Canvas::new((pill.2 * s).ceil() as i32, (pill.3 * s).ceil() as i32);
    let room = words.width;
    text.draw_centered(&mut words, &label, font * s, Rgba::hex(0xffffff), 0, room);
    let (left, top) = ((pill.0 * s).round() as i32, (pill.1 * s).round() as i32);
    for y in 0..words.height {
        for x in 0..words.width {
            let alpha = words.pixels[((y * words.width + x) * 4 + 3) as usize];
            if alpha > 0 {
                canvas.blend(
                    left + x,
                    top + y,
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
        scale.max(1),
        Transform::Normal,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::{ARROW, edge_distance, inside, resample};

    #[test]
    fn the_arrow_has_a_tip_and_a_tail() {
        assert!(inside(&ARROW, 1.0, 4.0));
        assert!(inside(&ARROW, 7.5, 16.5));
        assert!(!inside(&ARROW, 8.0, 4.0));
        assert!(!inside(&ARROW, -1.0, 4.0));
        assert!(edge_distance(&ARROW, 0.0, 8.0) < 0.01);
    }

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
