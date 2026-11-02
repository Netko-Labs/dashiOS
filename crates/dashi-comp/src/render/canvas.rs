//! A small RGBA canvas for what the compositor draws itself (title bars,
//! traffic lights): premultiplied alpha, in R, G, B, A byte order (Fourcc
//! Abgr8888), anti-aliased shapes.

pub(crate) struct Canvas {
    pub width: i32,
    pub height: i32,
    pub pixels: Vec<u8>,
}

/// A straight (not premultiplied) color, 0–255 per channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rgba(pub u8, pub u8, pub u8, pub u8);

impl Rgba {
    pub(crate) const fn hex(rgb: u32) -> Self {
        Rgba((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, 255)
    }
}

impl Canvas {
    pub(crate) fn new(width: i32, height: i32) -> Self {
        let (w, h) = (width.max(1), height.max(1));
        Self {
            width: w,
            height: h,
            pixels: vec![0; (w * h * 4) as usize],
        }
    }

    /// Blend `color` over the pixel at (x, y) with `coverage` (0–1).
    pub(crate) fn blend(&mut self, x: i32, y: i32, color: Rgba, coverage: f32) {
        if x < 0 || y < 0 || x >= self.width || y >= self.height || coverage <= 0.0 {
            return;
        }
        let alpha = (f32::from(color.3) / 255.0) * coverage.min(1.0);
        let at = ((y * self.width + x) * 4) as usize;
        let px = &mut self.pixels[at..at + 4];
        for (channel, value) in [color.0, color.1, color.2].into_iter().enumerate() {
            let src = f32::from(value) * alpha;
            px[channel] = (src + f32::from(px[channel]) * (1.0 - alpha)).round() as u8;
        }
        px[3] = (alpha * 255.0 + f32::from(px[3]) * (1.0 - alpha)).round() as u8;
    }

    /// A rectangle with its top corners rounded by `radius` (a title bar).
    pub(crate) fn fill_top_rounded(&mut self, color: Rgba, radius: f32) {
        let (w, h) = (self.width as f32, self.height as f32);
        for y in 0..self.height {
            for x in 0..self.width {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let coverage = if py < radius && (px < radius || px > w - radius) {
                    let cx = if px < radius { radius } else { w - radius };
                    let distance = ((px - cx).powi(2) + (py - radius).powi(2)).sqrt();
                    (radius - distance + 0.5).clamp(0.0, 1.0)
                } else if py <= h {
                    1.0
                } else {
                    0.0
                };
                self.blend(x, y, color, coverage);
            }
        }
    }

    /// A horizontal line along the bottom edge.
    pub(crate) fn bottom_line(&mut self, color: Rgba) {
        for x in 0..self.width {
            self.blend(x, self.height - 1, color, 1.0);
        }
    }

    /// A filled, anti-aliased circle.
    pub(crate) fn circle(&mut self, cx: f32, cy: f32, radius: f32, color: Rgba) {
        let (x0, x1) = (
            (cx - radius - 1.0).floor() as i32,
            (cx + radius + 1.0).ceil() as i32,
        );
        let (y0, y1) = (
            (cy - radius - 1.0).floor() as i32,
            (cy + radius + 1.0).ceil() as i32,
        );
        for y in y0..=y1 {
            for x in x0..=x1 {
                let distance =
                    ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                self.blend(x, y, color, (radius - distance + 0.5).clamp(0.0, 1.0));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(canvas: &Canvas, x: i32, y: i32) -> [u8; 4] {
        let at = ((y * canvas.width + x) * 4) as usize;
        canvas.pixels[at..at + 4].try_into().unwrap()
    }

    #[test]
    fn rounded_top_corners_are_clear_and_the_rest_is_filled() {
        let mut canvas = Canvas::new(40, 20);
        canvas.fill_top_rounded(Rgba::hex(0xececec), 8.0);
        assert_eq!(pixel(&canvas, 0, 0)[3], 0, "the corner is cut");
        assert_eq!(pixel(&canvas, 20, 0), [0xec, 0xec, 0xec, 255]);
        assert_eq!(
            pixel(&canvas, 0, 19),
            [0xec, 0xec, 0xec, 255],
            "the bottom corners are square"
        );
    }

    #[test]
    fn circles_are_solid_inside_and_premultiplied_at_the_edge() {
        let mut canvas = Canvas::new(20, 20);
        canvas.circle(10.0, 10.0, 6.0, Rgba(255, 0, 0, 255));
        assert_eq!(pixel(&canvas, 10, 10), [255, 0, 0, 255]);
        assert_eq!(pixel(&canvas, 0, 0), [0, 0, 0, 0]);
        let edge = pixel(&canvas, 14, 14);
        assert!(
            edge[3] > 0 && edge[3] < 255 && edge[0] <= edge[3],
            "{edge:?}"
        );
    }
}
