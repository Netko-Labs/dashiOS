//! Photos and posters: a frame as a JPEG (the `image` crate's encoder, in
//! Rust, MIT or Apache-2.0), never over a file that is there. A poster is the
//! same frame no wider than `POSTER_WIDTH`, for the Camera app's last shots
//! and an agent's look at what it took.

use std::{fs::OpenOptions, io::BufWriter, path::Path};

use image::{RgbImage, codecs::jpeg::JpegEncoder, imageops};

/// JPEG quality for photos; posters are smaller and lower.
const QUALITY: u8 = 92;
const POSTER_QUALITY: u8 = 80;
pub const POSTER_WIDTH: u32 = 480;

/// A frame: tightly packed RGB rows.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}

impl Frame {
    fn image(&self) -> Result<RgbImage, String> {
        RgbImage::from_raw(self.width, self.height, self.rgb.clone())
            .ok_or_else(|| "the frame is the wrong size".to_string())
    }
}

/// The size of a poster for a `width`×`height` frame: as wide as `POSTER_WIDTH` at most, same shape.
pub fn poster_size(width: u32, height: u32) -> (u32, u32) {
    if width <= POSTER_WIDTH {
        return (width.max(1), height.max(1));
    }
    let h = (u64::from(height) * u64::from(POSTER_WIDTH) / u64::from(width.max(1))).max(1);
    (POSTER_WIDTH, h as u32)
}

fn write(image: &RgbImage, path: &Path, quality: u8) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    let mut out = BufWriter::new(file);
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(image)
        .map_err(|error| format!("{}: {error}", path.display()))
}

/// The photo at `path`, full size.
pub fn save_photo(frame: &Frame, path: &Path) -> Result<(), String> {
    write(&frame.image()?, path, QUALITY)
}

/// The poster at `path`, small.
pub fn save_poster(frame: &Frame, path: &Path) -> Result<(), String> {
    let image = frame.image()?;
    let (w, h) = poster_size(frame.width, frame.height);
    let small = if (w, h) == (frame.width, frame.height) {
        image
    } else {
        imageops::thumbnail(&image, w, h)
    };
    write(&small, path, POSTER_QUALITY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posters_keep_the_shape() {
        assert_eq!(poster_size(1920, 1080), (480, 270));
        assert_eq!(poster_size(1280, 720), (480, 270));
        assert_eq!(poster_size(320, 240), (320, 240));
        assert_eq!(poster_size(4000, 1), (480, 1));
    }

    #[test]
    fn a_photo_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("dashi-camera-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a temp dir");
        let path = dir.join("Photo.jpg");
        let _ = std::fs::remove_file(&path);
        let frame = Frame {
            width: 4,
            height: 2,
            rgb: vec![200; 4 * 2 * 3],
        };
        save_photo(&frame, &path).expect("written");
        assert!(
            std::fs::read(&path)
                .expect("there")
                .starts_with(&[0xff, 0xd8])
        );
        assert!(save_photo(&frame, &path).is_err(), "not over the first");
        let short = Frame {
            width: 4,
            height: 2,
            rgb: vec![0; 5],
        };
        assert!(save_poster(&short, &dir.join("p.jpg")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
