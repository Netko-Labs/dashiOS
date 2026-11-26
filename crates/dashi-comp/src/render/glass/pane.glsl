// The part of the texture drawn (x, y, width, height, as fractions of it).
uniform vec4 crop;
// The pane within what is drawn (its hairline around it), in the frame's pixels.
uniform vec4 pane;
// What is drawn's size, the pane's corner radius, the grain.
uniform vec4 shape;
// Saturation, brightness, the rim's width, the hairline's.
uniform vec4 lift;
// Premultiplied.
uniform vec4 glass_tint;
// The words' luminance and the contrast they keep (0: no floor), and how far round each pixel
// (the frame's pixels) the floor looks for the hardest ground (0: the pixel's own).
uniform vec2 floor_ink;
uniform float floor_reach;
// The solid twin (rgb), and whether it is drawn instead (a).
uniform vec4 solid;
// The rim from the top through the middle to the bottom, and the hairline (premultiplied).
uniform vec4 rim_top;
uniform vec4 rim_mid;
uniform vec4 rim_bot;
uniform vec4 keel;
// The window's frame the pane is cut to (pane coordinates; zero size: none), its radii top
// and bottom.
uniform vec4 clip;
uniform vec2 clip_radii;

float grain(vec2 p) {
    return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}

float luma(vec3 c) {
    return dot(pow(clamp(c, 0.0, 1.0), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722));
}

// How far a ground `c` is past what the words need (below 0: short), the grain at its worst.
float spare(vec3 c, float need, bool dark) {
    float g = shape.w * 0.5;
    return dark ? luma(c - vec3(g)) - need : need - luma(c + vec3(g));
}

// The colour behind, its colours lifted.
vec3 lifted(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(l), c, lift.x) * lift.y, 0.0, 1.0);
}

// The hardest ground for the words within `floor_reach` of here: the darkest for dark words, the
// lightest for light ones, of the pixel and eight round it. The floor read from it moves slowly
// across the pane, so the backdrop's light and shade still show through (per pixel it flattened
// them into one pastel).
vec3 hardest(vec3 rgb, bool dark) {
    if (floor_reach <= 0.0) {
        return rgb;
    }
    vec2 step = floor_reach * crop.zw / shape.xy;
    vec3 worst = rgb;
    float at = luma(rgb);
    for (int i = 0; i < 8; i++) {
        float turn = float(i) * 0.7853982;
        vec3 c = lifted(texture2D(tex, v_coords + step * vec2(cos(turn), sin(turn))).rgb);
        float l = luma(c);
        if (dark ? l < at : l > at) {
            worst = c;
            at = l;
        }
    }
    return worst;
}

// The tint laid over `rgb`, raised (never lowered) until the words keep their ratio over `ground`.
// The halvings end on a straight line between the last two, so neighbouring grounds get
// neighbouring α: six halvings alone left steps of 1/64 that followed the backdrop as bands.
vec3 tinted(vec3 rgb, vec3 ground, bool dark) {
    float a = glass_tint.a;
    if (floor_ink.y <= 0.0 || a <= 0.0) {
        return rgb * (1.0 - a) + glass_tint.rgb;
    }
    vec3 t = glass_tint.rgb / a;
    float ink = floor_ink.x;
    float need = dark ? floor_ink.y * (ink + 0.05) - 0.05 : (ink + 0.05) / floor_ink.y - 0.05;
    float low = spare(mix(ground, t, a), need, dark);
    if (low < 0.0) {
        float lo = a;
        float hi = 1.0;
        float high = spare(t, need, dark);
        for (int i = 0; i < 6; i++) {
            float mid = (lo + hi) * 0.5;
            float s = spare(mix(ground, t, mid), need, dark);
            if (s < 0.0) {
                lo = mid;
                low = s;
            } else {
                hi = mid;
                high = s;
            }
        }
        a = high > low ? mix(lo, hi, clamp(-low / (high - low), 0.0, 1.0)) : hi;
    }
    return mix(rgb, t, a);
}

// The signed distance from `p` to a box at `at`, `size` big, its corners `r` round.
float rounded(vec2 p, vec2 at, vec2 size, float r) {
    vec2 q = abs(p - at - size * 0.5) - (size * 0.5 - vec2(r));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec2 local = (v_coords - crop.xy) / crop.zw;
    vec2 p = local * shape.xy - pane.xy;
    vec3 rgb;
    if (solid.a > 0.5) {
        rgb = solid.rgb;
    } else {
        rgb = lifted(texture2D(tex, v_coords).rgb);
        bool dark = floor_ink.x < 0.18;
        rgb = tinted(rgb, hardest(rgb, dark), dark);
        rgb += (grain(p) - 0.5) * shape.w;
    }
    float d = rounded(p, vec2(0.0), pane.zw, shape.z);
    float inside = clamp(0.5 - d, 0.0, 1.0);
    // The rim: a band `lift.z` wide inside the edge, light from above.
    float band = inside - clamp(0.5 - d - lift.z, 0.0, 1.0);
    float t = clamp(p.y / max(pane.w, 1.0), 0.0, 1.0);
    vec4 rim = t < 0.5 ? mix(rim_top, rim_mid, t * 2.0) : mix(rim_mid, rim_bot, t * 2.0 - 1.0);
    rgb = clamp(rgb, 0.0, 1.0) * (1.0 - rim.a * band) + rim.rgb * band;
    // The hairline: a band `lift.w` wide outside it.
    float outside = clamp(0.5 - d + lift.w, 0.0, 1.0) - inside;
    vec4 color = vec4(rgb, 1.0) * inside + keel * outside;
    if (clip.z > 0.0) {
        float r = p.y < clip.y + clip.w * 0.5 ? clip_radii.x : clip_radii.y;
        color *= clamp(0.5 - rounded(p, clip.xy, clip.zw, r), 0.0, 1.0);
    }
    gl_FragColor = color * alpha;
}
