/** Just enough CBOR (RFC 8949) for WebAuthn's attestation objects and COSE keys, both ways. */

export type Cbor = number | string | Uint8Array | boolean | null | Cbor[] | Map<Cbor, Cbor>;

export function decode(bytes: Uint8Array): { value: Cbor; length: number } {
  let at = 0;
  const take = (n: number) => {
    if (at + n > bytes.length) throw new Error("CBOR cut short");
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const argument = (info: number): number => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size) throw new Error("unsupported CBOR length");
    return take(size).reduce((n, b) => n * 256 + b, 0);
  };
  const item = (): Cbor => {
    const [head] = take(1);
    const major = (head ?? 0) >> 5;
    const info = (head ?? 0) & 31;
    if (major === 7) return info === 20 ? false : info === 21 ? true : null;
    const n = argument(info);
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 2:
        return take(n).slice();
      case 3:
        return new TextDecoder().decode(take(n));
      case 4:
        return Array.from({ length: n }, item);
      case 5: {
        const map = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) map.set(item(), item());
        return map;
      }
      default:
        throw new Error("unsupported CBOR");
    }
  };
  const value = item();
  return { value, length: at };
}

export function encode(value: Cbor): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else if (n < 65536) out.push((major << 5) | 25, n >> 8, n & 255);
    else out.push((major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  const item = (v: Cbor) => {
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") {
      const b = new TextEncoder().encode(v);
      head(3, b.length);
      out.push(...b);
    } else if (v instanceof Uint8Array) {
      head(2, v.length);
      out.push(...v);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      v.forEach(item);
    } else if (v instanceof Map) {
      head(5, v.size);
      for (const [k, x] of v) {
        item(k);
        item(x);
      }
    } else out.push(v === true ? 0xf5 : v === false ? 0xf4 : 0xf6);
  };
  item(value);
  return new Uint8Array(out);
}
