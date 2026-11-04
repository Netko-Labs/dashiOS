//! Text the compositor draws itself (window titles), with cosmic-text. The font
//! system is loaded the first time it is needed: a compositor whose windows all
//! draw their own title bars never pays for it.

use cosmic_text::{Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};

use super::canvas::{Canvas, Rgba};

#[derive(Default)]
pub(crate) struct Text {
    fonts: Option<FontSystem>,
    glyphs: Option<SwashCache>,
}

impl Text {
    /// How wide one line of `text` sets at `size`, in the canvas's pixels.
    pub(crate) fn width(&mut self, text: &str, size: f32) -> f32 {
        let fonts = self.fonts.get_or_insert_with(FontSystem::new);
        let mut buffer = Buffer::new(fonts, Metrics::new(size, size * 1.25));
        buffer.set_size(fonts, None, None);
        let attrs = Attrs::new()
            .family(Family::SansSerif)
            .weight(Weight::SEMIBOLD);
        buffer.set_text(fonts, text, &attrs, Shaping::Advanced);
        buffer.shape_until_scroll(fonts, false);
        buffer
            .layout_runs()
            .map(|run| run.line_w)
            .fold(0.0, f32::max)
    }

    /// Draw one line of `text` centered between `left` and `right` (canvas
    /// pixels), shortened with an ellipsis when it does not fit.
    pub(crate) fn draw_centered(
        &mut self,
        canvas: &mut Canvas,
        text: &str,
        size: f32,
        color: Rgba,
        left: i32,
        right: i32,
    ) {
        let room = (right - left) as f32;
        if room <= size {
            return;
        }
        let fonts = self.fonts.get_or_insert_with(FontSystem::new);
        let glyphs = self.glyphs.get_or_insert_with(SwashCache::new);
        let mut buffer = Buffer::new(fonts, Metrics::new(size, size * 1.25));
        buffer.set_size(fonts, None, Some(canvas.height as f32));
        let attrs = Attrs::new()
            .family(Family::SansSerif)
            .weight(Weight::SEMIBOLD);

        let mut shown: String = text.to_owned();
        loop {
            buffer.set_text(fonts, &shown, &attrs, Shaping::Advanced);
            buffer.shape_until_scroll(fonts, false);
            let width = buffer
                .layout_runs()
                .map(|run| run.line_w)
                .fold(0.0, f32::max);
            if width <= room || shown.chars().count() <= 1 {
                break;
            }
            // Shorten by a character at a time and end with an ellipsis.
            let mut chars: Vec<char> = shown.trim_end_matches('…').chars().collect();
            chars.pop();
            shown = chars.into_iter().collect::<String>().trim_end().to_owned() + "…";
        }

        let width = buffer
            .layout_runs()
            .map(|run| run.line_w)
            .fold(0.0, f32::max);
        let x0 = left as f32 + (room - width) / 2.0;
        let line_height = size * 1.25;
        let y0 = (canvas.height as f32 - line_height) / 2.0;
        let base = Color::rgba(color.0, color.1, color.2, color.3);
        for run in buffer.layout_runs() {
            for glyph in run.glyphs {
                let physical = glyph.physical((x0, y0), 1.0);
                glyphs.with_pixels(fonts, physical.cache_key, base, |x, y, pixel| {
                    let coverage = f32::from(pixel.a()) / 255.0;
                    canvas.blend(
                        physical.x + x,
                        run.line_y as i32 + physical.y + y,
                        color,
                        coverage,
                    );
                });
            }
        }
    }
}
