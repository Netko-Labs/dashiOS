//! One of a thing per scale it is drawn at: a window's title bar, drawn for
//! each screen scale it shows on. Two screens at 1× and 2× each keep their
//! own, instead of drawing it again for the other every frame (which kept a
//! mixed-scale desk from ever going idle).

/// At most this many scales are kept (screens at different scales, a capture).
const KEPT: usize = 4;

pub(crate) struct ByScale<T> {
    /// (scale, thing), the latest set last.
    kept: Vec<(i32, T)>,
}

impl<T> Default for ByScale<T> {
    fn default() -> Self {
        Self { kept: Vec::new() }
    }
}

impl<T> ByScale<T> {
    pub(crate) fn get(&self, scale: i32) -> Option<&T> {
        self.kept.iter().find(|(s, _)| *s == scale).map(|(_, t)| t)
    }

    /// Keep `thing` for `scale`, in place of the one there was; past `KEPT`
    /// scales, the one set longest ago goes.
    pub(crate) fn set(&mut self, scale: i32, thing: T) {
        self.kept.retain(|(s, _)| *s != scale);
        if self.kept.len() >= KEPT {
            self.kept.remove(0);
        }
        self.kept.push((scale, thing));
    }

    pub(crate) fn clear(&mut self) {
        self.kept.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_scale_keeps_its_own() {
        let mut images = ByScale::default();
        images.set(1, "1x");
        images.set(2, "2x");
        assert_eq!(images.get(1), Some(&"1x"));
        assert_eq!(images.get(2), Some(&"2x"));
        // A change drawn at one scale leaves the other's.
        images.set(2, "2x, active");
        assert_eq!(images.get(1), Some(&"1x"));
        assert_eq!(images.get(2), Some(&"2x, active"));
        assert_eq!(images.get(3), None);
        images.clear();
        assert_eq!(images.get(1), None);
    }

    #[test]
    fn only_a_few_scales_are_kept() {
        let mut images = ByScale::default();
        for scale in 1..=5 {
            images.set(scale, scale);
        }
        assert_eq!(images.get(1), None);
        assert_eq!(images.get(5), Some(&5));
        assert_eq!(images.get(2), Some(&2));
    }
}
