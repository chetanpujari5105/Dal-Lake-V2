/** Hash-based value noise and fbm for shaders (no textures needed). */
export const GLSL_NOISE = /* glsl */ `
float n2hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = n2hash(i);
  float b = n2hash(i + vec2(1.0, 0.0));
  float c = n2hash(i + vec2(0.0, 1.0));
  float d = n2hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += vnoise(p) * a;
    p = p * 2.07 + vec2(17.1, -9.3);
    a *= 0.5;
  }
  return s / 0.875;
}
`;
