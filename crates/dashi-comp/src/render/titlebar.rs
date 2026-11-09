//! The title bar dashi-comp draws above a window that lets it (xdg-decoration
//! server side), and the traffic lights alone over a "unified" window
//! (dashi-chrome-v1). Geometry is in logical pixels; images are drawn at the
//! output's scale and cached until something they show changes. A unified
//! window keeps its lights everywhere it is drawn: in full screen (its app
//! keeps their place clear in its toolbar), and small or moving (the overview,
//! a flight to the Dock, a Desktop sliding in, the shell's pictures), where
//! they shrink with it at the same spot.

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    utils::{Logical, Size, Transform},
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
/// A unified window's toolbar strip: the controls are centered in it, and
/// the app lays its toolbar and sidebar top to it (@dashi/ui's AppWindow
/// toolbar is 38 px), so the title and the controls share a center line.
pub(crate) const UNIFIED_HEIGHT: i32 = 38;
/// The window controls and their margins: what a unified window keeps clear.
pub(crate) const CONTROLS: (i32, i32, i32, i32) = (0, 0, 76, UNIFIED_HEIGHT);

/// The strip the controls are centered in: the bar, or a unified window's toolbar.
fn strip_height(decor: Decor) -> i32 {
    if decor == Decor::Unified {
        UNIFIED_HEIGHT
    } else {
        BAR_HEIGHT
    }
}

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

    /// Whether dashi-comp draws this window's chrome (`fullscreen`: while it
    /// is full screen). A title bar goes in full screen, so the window is edge
    /// to edge; a unified window's lights stay, where its app keeps them clear.
    pub(crate) fn drawn(self, fullscreen: bool) -> bool {
        match self {
            Decor::None => false,
            Decor::Standard => !fullscreen,
            Decor::Unified => true,
        }
    }

    /// The size of the image drawn for a window `width` wide (logical): the
    /// whole bar, or just the lights and their margins.
    pub(crate) fn image_size(self, width: i32) -> Size<i32, Logical> {
        match self {
            Decor::Unified => Size::from((CONTROLS.2, CONTROLS.3)),
            _ => Size::from((width.max(1), BAR_HEIGHT)),
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
        || y >= f64::from(strip_height(decor))
        || x < 0.0
        || x >= f64::from(width)
    {
        return None;
    }
    let lights = [Part::Close, Part::Minimize, Part::Zoom];
    let hit = lights.iter().enumerate().find(|(index, _)| {
        let cx = f64::from(FIRST_LIGHT_X + LIGHT_STEP * *index as f32);
        let cy = f64::from(strip_height(decor)) / 2.0;
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

impl Image {
    /// Its size, logical: what it covers of the window at full size, from its top-left.
    pub(crate) fn size(&self) -> Size<i32, Logical> {
        self.look.decor.image_size(self.look.width)
    }

    /// Whether it shows on a window with a bar `bar` high now: a unified
    /// window's lights always do, a title bar only while there is one.
    pub(crate) fn shows(&self, bar: f64) -> bool {
        self.look.decor == Decor::Unified || bar > 0.0
    }
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
        assert_eq!(part_at(20.0, 19.0, 600, Decor::Unified), Some(Part::Close));
        assert_eq!(
            part_at(20.0, 10.0, 600, Decor::Unified),
            None,
            "lined up with a 38 px toolbar"
        );
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

    #[test]
    fn a_unified_window_keeps_its_lights_in_full_screen() {
        assert!(Decor::Unified.drawn(true), "no gap where the lights were");
        assert!(Decor::Unified.drawn(false));
        assert!(!Decor::Standard.drawn(true), "edge to edge, no bar");
        assert!(Decor::Standard.drawn(false));
        assert!(!Decor::None.drawn(true));
        assert!(!Decor::None.drawn(false));
    }

    #[test]
    fn the_lights_image_covers_what_the_app_keeps_clear() {
        assert_eq!(
            Decor::Unified.image_size(1200),
            Size::from((CONTROLS.2, CONTROLS.3))
        );
        assert_eq!(
            Decor::Standard.image_size(600),
            Size::from((600, BAR_HEIGHT))
        );
        // Every light sits inside it, so it shrinks with the window whole.
        for (index, part) in [Part::Close, Part::Minimize, Part::Zoom]
            .into_iter()
            .enumerate()
        {
            let (w, h, _) = shape(part);
            let cx = FIRST_LIGHT_X + LIGHT_STEP * index as f32;
            assert!(cx + w * HOVER_SCALE / 2.0 <= CONTROLS.2 as f32);
            assert!(h * HOVER_SCALE <= CONTROLS.3 as f32);
        }
    }
}
