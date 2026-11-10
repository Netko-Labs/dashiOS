/**
 * A copied picture's size, read from its header (PNG, JPEG, GIF, WebP, BMP),
 * for the row's "1646 × 937". Pure over the bytes; a header it can't read
 * is no size, never an error.
 */

export interface Size {
  width: number;
  height: number;
}

/** The file extension a picture of `mime` is kept under. */
export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    default:
      return "png";
  }
}

const sized = (width: number, height: number): Size | null => (width > 0 && height > 0 ? { width, height } : null);

function png(bytes: Uint8Array, view: DataView): Size | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((byte, at) => bytes[at] === byte)) return null;
  return sized(view.getUint32(16), view.getUint32(20));
}

function gif(bytes: Uint8Array, view: DataView): Size | null {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 4)) !== "GIF8") return null;
  return sized(view.getUint16(6, true), view.getUint16(8, true));
}

function bmp(bytes: Uint8Array, view: DataView): Size | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  return sized(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
}

function webp(bytes: Uint8Array, view: DataView): Size | null {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") return sized(1 + (view.getUint32(24, true) & 0xffffff), 1 + (view.getUint32(27, true) & 0xffffff));
  if (chunk === "VP8 ") return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

/** JPEG: the first start-of-frame marker's height and width. */
function jpeg(bytes: Uint8Array, view: DataView): Size | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    // SOF0 to SOF15, without DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return sized(view.getUint16(at + 7), view.getUint16(at + 5));
    }
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}

export function imageSize(bytes: Uint8Array): Size | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    return png(bytes, view) ?? jpeg(bytes, view) ?? gif(bytes, view) ?? webp(bytes, view) ?? bmp(bytes, view);
  } catch {
    return null;
  }
}
