//! Where a capture is saved: a path checked before anything is drawn, and the
//! PNG encoded and written off the event loop (ipc/methods/capture.rs).

use std::{fs::OpenOptions, io::BufWriter, path::Path};

use super::capture::Picture;

/// Where a capture may go: an absolute `.png` path whose folder exists, not a file already there.
pub(crate) fn check_path(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("png") {
        return Err("`path` must be an absolute .png path".into());
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("`path` must not climb with ..".into());
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err("the folder for `path` does not exist".into());
    }
    Ok(path)
}

/// Encode and write `picture` (whole seconds for a big screen): off the event
/// loop only (ipc/methods/capture.rs).
#[expect(
    clippy::disallowed_methods,
    reason = "the PNG work itself: save_png is disallowed, so its callers carry the H12 marks"
)]
pub(crate) fn save_png(path: &Path, picture: &Picture) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    let mut encoder = png::Encoder::new(
        BufWriter::new(file),
        picture.width as u32,
        picture.height as u32,
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer
        .write_image_data(&picture.rgba)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_paths_are_checked() {
        assert!(check_path("relative.png").is_err());
        assert!(check_path("/tmp/shot.jpg").is_err());
        assert!(check_path("/tmp/../etc/shot.png").is_err());
        assert!(check_path("/no/such/folder/shot.png").is_err());
        assert!(check_path("/tmp/shot.png").is_ok());
    }
}
