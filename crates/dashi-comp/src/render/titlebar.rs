//! The title bar dashi-comp draws above a window that lets it (xdg-decoration
//! server side), and the traffic lights alone over a "unified" window
//! (dashi-chrome-v1). Geometry is in logical pixels; images are drawn at the
//! output's scale and cached until something they show changes.

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::Transform,
};

use super::{
    canvas::{Canvas, Rgba},
    text::Text,
};

pub(crate) const BAR_HEIGHT: i32 = 28;
/// Dashi's window controls ("Shapes", as 0.1.0 drew them, and as
/// packages/shell/src/appearance/gtk-css.ts gives GTK apps): a circle closes,
/// a bar minimizes, a rounded square zooms; centers 20 px apart from 20 px in.
const FIRST_LIGHT_X: f32 = 20.0;
const LIGHT_STEP: f32 = 20.0;
/// How far from a control's center a press still lands on it.
const LIGHT_REACH: f32 = 8.0;
/// A hovered control grows by this much.
const HOVER_SCALE: f32 = 1.18;
/// The traffic lights and their margins: what a unified window keeps clear.
pub(crate) const CONTROLS: (i32, i32, i32, i32) = (0, 0, 76, BAR_HEIGHT);

/// How a window is framed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Decor {
    /// The client draws its own (client-side decorations, or none).
    None,
    /// dashi-comp's title bar above the surface.
    Standard,
    /// No title bar; the traffic lights over the surface (dashi-chrome-v1).
    Unified,
}

impl Decor {
    pub(crate) fn bar_height(self) -> i32 {
        if self == Decor::Standard {
            BAR_HEIGHT
        } else {
            0
        }
    }
}

/// What a press on a window's chrome is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Part {
    Close,
    Minimize,
    Zoom,
    /// The bar itself: drag to move, double-click to zoom.
    Bar,
}

/// The part at (x, y) of a title bar (or a unified window's lights area),
/// relative to its top-left; None outside the strip.
pub(crate) fn part_at(x: f64, y: f64, width: i32, decor: Decor) -> Option<Part> {
    if decor == Decor::None
        || y < 0.0
        || y >= f64::from(BAR_HEIGHT)
        || x < 0.0
        || x >= f64::from(width)
    {
        return None;
    }
    let lights = [Part::Close, Part::Minimize, Part::Zoom];
    let hit = lights.iter().enumerate().find(|(index, _)| {
        let cx = f64::from(FIRST_LIGHT_X + LIGHT_STEP * *index as f32);
        let cy = f64::from(BAR_HEIGHT) / 2.0;
        (x - cx).powi(2) + (y - cy).powi(2) <= f64::from(LIGHT_REACH).powi(2)
    });
    match (hit, decor) {
        (Some((_, part)), _) => Some(*part),
        (None, Decor::Standard) => Some(Part::Bar),
        // Outside the lights, a unified window's top is the app's own.
        (None, _) => None,
    }
}

/// Everything a title bar image shows: when it changes, the image is drawn again.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Look {
    pub decor: Decor,
    pub width: i32,
    pub title: String,
    pub active: bool,
    pub dark: bool,
    pub radius: i32,
    pub scale: i32,
    /// The control under the pointer: the controls take their colors (even on
    /// an unfocused window) and that one grows.
    pub hover: Option<Part>,
}

pub(crate) struct Image {
    pub look: Look,
    pub buffer: MemoryRenderBuffer,
}

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
        (true, true) => Palette {
            bar: Rgba::hex(0x2c2c2e),
            line: Rgba::hex(0x1c1c1e),
            text: Rgba::hex(0xe6e6e8),
            idle_light: INACTIVE_DARK,
        },
        (true, false) => Palette {
            bar: Rgba::hex(0x242426),
            line: Rgba::hex(0x18181a),
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
fn shape(part: Part) -> (f32, f32, f32) {
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
    let (width, height) = match look.decor {
        Decor::Unified => (CONTROLS.2, CONTROLS.3),
        _ => (look.width.max(1), BAR_HEIGHT),
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presses_find_the_lights_then_the_bar() {
        assert_eq!(part_at(20.0, 14.0, 600, Decor::Standard), Some(Part::Close));
        assert_eq!(
            part_at(40.0, 14.0, 600, Decor::Standard),
            Some(Part::Minimize)
        );
        assert_eq!(part_at(60.0, 15.0, 600, Decor::Standard), Some(Part::Zoom));
        assert_eq!(part_at(300.0, 10.0, 600, Decor::Standard), Some(Part::Bar));
        assert_eq!(
            part_at(300.0, 30.0, 600, Decor::Standard),
            None,
            "below the bar is the window"
        );
        assert_eq!(part_at(20.0, 14.0, 600, Decor::Unified), Some(Part::Close));
        assert_eq!(
            part_at(300.0, 10.0, 600, Decor::Unified),
            None,
            "a unified window's top is the app's"
        );
        assert_eq!(part_at(20.0, 14.0, 600, Decor::None), None);
    }

    #[test]
    fn only_standard_windows_have_a_bar() {
        assert_eq!(Decor::Standard.bar_height(), BAR_HEIGHT);
        assert_eq!(Decor::Unified.bar_height(), 0);
        assert_eq!(Decor::None.bar_height(), 0);
    }
}
