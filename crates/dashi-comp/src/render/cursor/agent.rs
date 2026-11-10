//! The agent's pointer: a violet arrow with the agent's name in a pill, drawn
//! while an agent acts on the person's seat.

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::Transform,
};

use crate::render::{
    canvas::{Canvas, Rgba},
    text::Text,
};

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
pub(crate) fn agent_pointer(label: &str, scale: i32, text: &mut Text) -> MemoryRenderBuffer {
    let s = scale.max(1) as f32;
    let tip = AGENT_TIP as f32;
    let font = 11.0;
    let label: String = label.chars().take(40).collect();
    let text_width = text.width(&label, font * s) / s;
    let pill = (tip + 10.0, tip + 19.0, text_width.ceil() + 16.0, 18.0);
    let width = pill.0 + pill.2 + 3.0;
    let height = pill.1 + pill.3 + 3.0;
    let mut canvas = Canvas::new((width * s).ceil() as i32, (height * s).ceil() as i32);
    paint_arrow_and_pill(&mut canvas, pill, s);
    paint_label(&mut canvas, text, &label, pill, font, s);
    MemoryRenderBuffer::from_slice(
        &canvas.pixels,
        Fourcc::Abgr8888,
        (canvas.width, canvas.height),
        scale.max(1),
        Transform::Normal,
        None,
    )
}

/// The arrow (shadow, white edge, violet fill) and the name's empty pill, `s` pixels a point.
fn paint_arrow_and_pill(canvas: &mut Canvas, pill: (f32, f32, f32, f32), s: f32) {
    let tip = AGENT_TIP as f32;
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
}

/// The agent's name in white, centered in its pill.
fn paint_label(
    canvas: &mut Canvas,
    text: &mut Text,
    label: &str,
    pill: (f32, f32, f32, f32),
    font: f32,
    s: f32,
) {
    let mut words = Canvas::new((pill.2 * s).ceil() as i32, (pill.3 * s).ceil() as i32);
    let room = words.width;
    text.draw_centered(&mut words, label, font * s, Rgba::hex(0xffffff), 0, room);
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
}

#[cfg(test)]
mod tests {
    use super::{ARROW, edge_distance, inside};

    #[test]
    fn the_arrow_has_a_tip_and_a_tail() {
        assert!(inside(&ARROW, 1.0, 4.0));
        assert!(inside(&ARROW, 7.5, 16.5));
        assert!(!inside(&ARROW, 8.0, 4.0));
        assert!(!inside(&ARROW, -1.0, 4.0));
        assert!(edge_distance(&ARROW, 0.0, 8.0) < 0.01);
    }
}
