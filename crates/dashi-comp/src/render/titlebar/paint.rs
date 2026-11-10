//! Drawing a title bar, or a unified window's lights, as an image.

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::Transform,
};

use super::{
    CLOSE, CONTROLS, Decor, FIRST_LIGHT_X, HOVER_SCALE, LIGHT_STEP, Look, MINIMIZE, Part, ZOOM,
    palette,
};
use crate::render::{canvas::Canvas, text::Text};

/// A control's shape: width, height, corner radius (logical px).
pub(super) fn shape(part: Part) -> (f32, f32, f32) {
    match part {
        Part::Close => (12.0, 12.0, 6.0),
        Part::Minimize => (14.0, 5.0, 2.5),
        _ => (11.0, 11.0, 3.0),
    }
}

/// Draw `look` (a bar, or a unified window's lights).
pub(crate) fn draw(look: &Look, text: &mut Text) -> MemoryRenderBuffer {
    let s = look.scale.max(1);
    let colors = palette(look.dark, look.active);
    let size = look.decor.image_size(look.width);
    let (width, height) = (size.w, size.h);
    let mut canvas = Canvas::new(width * s, height * s);
    if look.decor == Decor::Standard {
        canvas.fill_top_rounded(colors.bar, (look.radius * s) as f32);
        canvas.bottom_line(colors.line);
    }
    let lit = look.active || look.hover.is_some();
    let controls = [
        (Part::Close, CLOSE),
        (Part::Minimize, MINIMIZE),
        (Part::Zoom, ZOOM),
    ];
    for (index, (part, color)) in controls.into_iter().enumerate() {
        let color = if lit { color } else { colors.idle_light };
        let grow = if look.hover == Some(part) {
            HOVER_SCALE
        } else {
            1.0
        };
        let (w, h, r) = shape(part);
        let px = s as f32 * grow;
        canvas.rounded_rect(
            (FIRST_LIGHT_X + LIGHT_STEP * index as f32) * s as f32,
            (height * s) as f32 / 2.0,
            w * px,
            h * px,
            r * px,
            color,
        );
    }
    if look.decor == Decor::Standard && !look.title.is_empty() {
        let margin = (CONTROLS.2 + 8) * s;
        let right = canvas.width - margin;
        text.draw_centered(
            &mut canvas,
            &look.title,
            13.0 * s as f32,
            colors.text,
            margin,
            right,
        );
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
