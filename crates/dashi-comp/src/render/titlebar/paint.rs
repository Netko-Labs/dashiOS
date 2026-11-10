//! Drawing a title bar, or a unified window's lights, as an image.

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::Transform,
};

use super::{CONTROLS, Decor, FIRST_LIGHT_X, HOVER_SCALE, LIGHT_STEP, Look, Part};
use crate::render::{
    canvas::{Canvas, Rgba},
    text::Text,
};

struct Palette {
    bar: Rgba,
    line: Rgba,
    text: Rgba,
    idle_light: Rgba,
}

fn palette(dark: bool, active: bool) -> Palette {
    match (dark, active) {
        (false, true) => Palette {
            bar: Rgba::hex(0xeeebe4),
            line: Rgba::hex(0xd9d5cc),
            text: Rgba::hex(0x262b28),
            idle_light: INACTIVE_LIGHT,
        },
        (false, false) => Palette {
            bar: Rgba::hex(0xf6f4ef),
            line: Rgba::hex(0xe4e0d8),
            text: Rgba::hex(0x9b9890),
            idle_light: INACTIVE_LIGHT,
        },
        // True black (the shell's TRUE_BLACK, @dashi/ui palette.ts): the
        // raised step when focused, the first lift when not, over a black
        // seam; the window under it is the black ground.
        (true, true) => Palette {
            bar: Rgba::hex(0x141417),
            line: Rgba::hex(0x000000),
            text: Rgba::hex(0xececee),
            idle_light: INACTIVE_DARK,
        },
        (true, false) => Palette {
            bar: Rgba::hex(0x0b0b0d),
            line: Rgba::hex(0x000000),
            text: Rgba::hex(0x8a8a8f),
            idle_light: INACTIVE_DARK,
        },
    }
}

/// ume, broth, and kombu: close, minimize, zoom.
const CLOSE: Rgba = Rgba::hex(0xd0596f);
const MINIMIZE: Rgba = Rgba::hex(0xe5b13f);
const ZOOM: Rgba = Rgba::hex(0x4a9a7e);
const INACTIVE_LIGHT: Rgba = Rgba::hex(0xcecbc6);
const INACTIVE_DARK: Rgba = Rgba::hex(0x525256);

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
