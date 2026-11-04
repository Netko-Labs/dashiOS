//! Wallpapers drawn here rather than loaded: the default gradient and the
//! three live ones (Northern Lights, Drift, Tide). They are soft enough to be
//! drawn small on the CPU and scaled up by the GPU; `t` is seconds.

/// The size they are drawn at; the GPU's filtering smooths the rest.
pub(crate) const WIDTH: usize = 320;
pub(crate) const HEIGHT: usize = 180;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Look {
    Gradient,
    Aurora,
    Drift,
    Tide,
}

impl Look {
    pub(crate) fn shader(name: &str) -> Option<Self> {
        match name {
            "aurora" => Some(Look::Aurora),
            "drift" => Some(Look::Drift),
            "tide" => Some(Look::Tide),
            _ => None,
        }
    }

    pub(crate) fn animated(self) -> bool {
        self != Look::Gradient
    }
}

type Rgb = [f32; 3];

fn hex(rgb: u32) -> Rgb {
    [
        ((rgb >> 16) & 0xff) as f32 / 255.0,
        ((rgb >> 8) & 0xff) as f32 / 255.0,
        (rgb & 0xff) as f32 / 255.0,
    ]
}

fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn smooth(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// One pixel of `look` at (u, v) in 0–1, `t` seconds in.
fn shade(look: Look, u: f32, v: f32, t: f32) -> Rgb {
    match look {
        Look::Gradient => {
            // Dashi's evening: indigo at the top left, violet, then a warm glow at the bottom right.
            let d = (u * 0.55 + v * 0.45).clamp(0.0, 1.0);
            let base = if d < 0.55 {
                mix(hex(0x1c1438), hex(0x6a3dc4), smooth(d / 0.55))
            } else {
                mix(hex(0x6a3dc4), hex(0xc9708a), smooth((d - 0.55) / 0.45))
            };
            let glow = (1.0 - ((u - 0.95).powi(2) + (v - 1.05).powi(2)).sqrt() / 0.6).max(0.0);
            mix(base, hex(0xf8a443), smooth(glow) * 0.9)
        }
        Look::Aurora => {
            // A deep night, and curtains of green and blue light along the top that sway.
            let sky = mix(hex(0x0b0d22), hex(0x16123a), v);
            let curtain = (u * 9.0 + (u * 3.0 + t * 0.15).sin() * 2.0 + t * 0.25).sin() * 0.5 + 0.5;
            let band = smooth(1.0 - (v - 0.22 - (u * 4.0 + t * 0.2).sin() * 0.05).abs() / 0.28);
            let color = mix(
                hex(0x2fb8a0),
                hex(0x5a5ad8),
                (u + (t * 0.05).sin() * 0.2).clamp(0.0, 1.0),
            );
            mix(sky, color, band * (0.35 + curtain * 0.5))
        }
        Look::Drift => {
            // Soft violet and amber clouds moving past each other.
            let a = ((u * 2.1 + t * 0.07).sin() + (v * 1.7 - t * 0.05).cos()) * 0.25 + 0.5;
            let b = ((u * 1.3 - t * 0.04).cos() * (v * 2.3 + t * 0.06).sin()) * 0.5 + 0.5;
            let base = mix(
                hex(0x6c49c2),
                hex(0x3a2d6e),
                smooth(u * 0.6 + v * 0.2 + a * 0.3),
            );
            mix(base, hex(0xc48a6a), smooth(b * (1.0 - v * 0.3) * v) * 0.8)
        }
        Look::Tide => {
            // A sunset over water, the waves rolling in.
            let horizon = 0.62;
            if v < horizon {
                let sky = mix(hex(0x241a46), hex(0xe0855c), smooth(v / horizon));
                let sun = (1.0
                    - ((u - 0.68).powi(2) * 3.0 + (v - horizon).powi(2) * 12.0).sqrt() / 0.5)
                    .max(0.0);
                mix(sky, hex(0xf6b25e), smooth(sun))
            } else {
                let depth = (v - horizon) / (1.0 - horizon);
                let wave = ((u * 10.0 + t * 0.6 + depth * 6.0).sin() * 0.5 + 0.5) * (1.0 - depth);
                let bands = ((depth * 4.0 + (u * 3.0 + t * 0.3).sin() * 0.15).floor() / 4.0)
                    .clamp(0.0, 1.0);
                mix(
                    mix(hex(0x3c3480), hex(0x120e2c), bands),
                    hex(0x5a4ca0),
                    wave * 0.25,
                )
            }
        }
    }
}

/// Draw `look` into straight RGBA pixels of WIDTH × HEIGHT.
pub(crate) fn draw(look: Look, t: f32, pixels: &mut [u8]) {
    for y in 0..HEIGHT {
        let v = (y as f32 + 0.5) / HEIGHT as f32;
        for x in 0..WIDTH {
            let u = (x as f32 + 0.5) / WIDTH as f32;
            let [r, g, b] = shade(look, u, v, t);
            let at = (y * WIDTH + x) * 4;
            pixels[at..at + 4].copy_from_slice(&[
                (r * 255.0) as u8,
                (g * 255.0) as u8,
                (b * 255.0) as u8,
                255,
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_look_fills_every_pixel_opaquely() {
        for look in [Look::Gradient, Look::Aurora, Look::Drift, Look::Tide] {
            let mut pixels = vec![0u8; WIDTH * HEIGHT * 4];
            draw(look, 12.5, &mut pixels);
            assert!(pixels.chunks(4).all(|px| px[3] == 255), "{look:?}");
        }
    }

    #[test]
    fn live_looks_move_and_the_gradient_does_not() {
        let frame = |look, t| {
            let mut pixels = vec![0u8; WIDTH * HEIGHT * 4];
            draw(look, t, &mut pixels);
            pixels
        };
        assert_eq!(frame(Look::Gradient, 0.0), frame(Look::Gradient, 5.0));
        assert_ne!(frame(Look::Tide, 0.0), frame(Look::Tide, 5.0));
        assert!(Look::shader("aurora").is_some_and(Look::animated));
        assert_eq!(Look::shader("plasma"), None);
    }
}
