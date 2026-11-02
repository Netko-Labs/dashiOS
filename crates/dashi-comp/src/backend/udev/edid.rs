//! A screen's make, model, and serial from its EDID (the connector's "EDID"
//! property): the manufacturer's three-letter code, then the descriptors'
//! monitor name and serial text, else the product code and serial number.

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Identity {
    pub make: String,
    pub model: String,
    pub serial: String,
}

const HEADER: [u8; 8] = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

/// The identity in an EDID block; None when `edid` is not one.
pub(crate) fn parse(edid: &[u8]) -> Option<Identity> {
    if edid.len() < 128 || edid[..8] != HEADER {
        return None;
    }
    let id = u16::from_be_bytes([edid[8], edid[9]]);
    let letter = |shift: u16| char::from(b'A' - 1 + ((id >> shift) & 0x1f) as u8);
    let make: String = [letter(10), letter(5), letter(0)].into_iter().collect();
    let product = u16::from_le_bytes([edid[10], edid[11]]);
    let serial_number = u32::from_le_bytes([edid[12], edid[13], edid[14], edid[15]]);

    let mut name = None;
    let mut serial_text = None;
    for descriptor in edid[54..126].as_chunks::<18>().0 {
        // A display descriptor starts with three zero bytes, then its tag.
        if descriptor[..3] != [0, 0, 0] {
            continue;
        }
        let text = descriptor_text(&descriptor[5..18]);
        match descriptor[3] {
            0xfc => name = Some(text),
            0xff => serial_text = Some(text),
            _ => {}
        }
    }
    Some(Identity {
        make: if make.chars().all(|c| c.is_ascii_uppercase()) {
            make
        } else {
            String::new()
        },
        model: name
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("{product:04X}")),
        serial: serial_text.filter(|s| !s.is_empty()).unwrap_or_else(|| {
            if serial_number == 0 {
                String::new()
            } else {
                serial_number.to_string()
            }
        }),
    })
}

/// A descriptor's text: ASCII, ended by a newline, padded with spaces.
fn descriptor_text(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take_while(|&&b| b != b'\n')
        .filter(|b| b.is_ascii_graphic() || **b == b' ')
        .map(|&b| char::from(b))
        .collect::<String>()
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An EDID with manufacturer "DEL", product 0xA0B1, serial 1234, and a name and serial descriptor.
    fn sample(with_descriptors: bool) -> Vec<u8> {
        let mut edid = vec![0u8; 128];
        edid[..8].copy_from_slice(&HEADER);
        // D=4, E=5, L=12: 00100 00101 01100
        let id: u16 = (4 << 10) | (5 << 5) | 12;
        edid[8..10].copy_from_slice(&id.to_be_bytes());
        edid[10..12].copy_from_slice(&0xa0b1u16.to_le_bytes());
        edid[12..16].copy_from_slice(&1234u32.to_le_bytes());
        if with_descriptors {
            let mut name = [0u8; 18];
            name[3] = 0xfc;
            name[5..18].copy_from_slice(b"DELL U2723Q\n ");
            edid[54..72].copy_from_slice(&name);
            let mut serial = [0u8; 18];
            serial[3] = 0xff;
            serial[5..18].copy_from_slice(b"ABC123\n      ");
            edid[72..90].copy_from_slice(&serial);
        }
        edid
    }

    #[test]
    fn names_come_from_the_descriptors() {
        assert_eq!(
            parse(&sample(true)),
            Some(Identity {
                make: "DEL".into(),
                model: "DELL U2723Q".into(),
                serial: "ABC123".into()
            })
        );
    }

    #[test]
    fn without_descriptors_the_codes_stand_in() {
        assert_eq!(
            parse(&sample(false)),
            Some(Identity {
                make: "DEL".into(),
                model: "A0B1".into(),
                serial: "1234".into()
            })
        );
    }

    #[test]
    fn anything_else_is_not_an_edid() {
        assert_eq!(parse(&[0u8; 128]), None);
        assert_eq!(parse(&sample(true)[..100]), None);
    }
}
