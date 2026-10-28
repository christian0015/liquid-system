/** GLSL ES 3.00 : SDF, verre optique à dispersion, gluant visqueux, environnement lumineux, fond ancré au document. */

export const MAX_BLOBS = 8;

/* Quad de la zone englobante d'un élément (coordonnées locales à la bande, en px, y vers le bas). */
export const VERT_ITEM = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uBounds; // x, y, w, h
uniform vec2 uVp;
out vec2 vPx;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vPx = uBounds.xy + c * uBounds.zw;
  vec2 ndc = vec2(vPx.x / uVp.x * 2.0 - 1.0, 1.0 - vPx.y / uVp.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const VERT_FULL = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c;
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
`;

/* Environnement lumineux (boîtes à lumière) : r = direction, z vers l'observateur. */
const ENV = /* glsl */ `
uniform int uEnv;       // 0 studio, 1 doux, 2 néon, 3 teinté
uniform float uDark;
uniform vec3 uBg;
uniform vec3 uBg2;
uniform vec3 uGlassC;
uniform vec3 uGlowC;
uniform vec3 uGlueC;
// Banc d'optique : boîtes à lumière franches dont les teintes viennent du thème (accent, verre, gluant).
vec3 envLight(vec3 r) {
  float x = r.x, y = r.y;
  vec3 warm = uGlowC * 1.8 + 0.12;
  vec3 cool = uGlassC * 1.6 + 0.1;
  vec3 deep = uGlueC * 1.7 + 0.05;
  vec3 bands;
  if (uEnv == 0 || uEnv == 3) {
    float vert = smoothstep(-0.9, -0.2, y) * smoothstep(1.0, 0.45, y);
    float b1 = smoothstep(0.075, 0.014, abs(x + 0.55));
    float b2 = smoothstep(0.13, 0.03, abs(x - 0.04)) * 0.9;
    float b3 = smoothstep(0.055, 0.01, abs(x - 0.6));
    float b4 = smoothstep(0.05, 0.01, abs(x + 0.14)) * 0.55;
    float b5 = smoothstep(0.04, 0.008, abs(x - 0.33)) * 0.75;
    float top = smoothstep(0.55, 0.92, y) * 0.5;
    vec3 white = uEnv == 3 ? cool : vec3(1.15);
    bands = (cool * b1 + white * b2 + warm * b3 + deep * b4 + warm * 0.8 * b5) * vert + vec3(1.0) * top;
  } else if (uEnv == 1) {
    float dome = smoothstep(-0.3, 0.95, y);
    float blob = smoothstep(0.75, 0.0, length(vec2(x - 0.25, y - 0.35)));
    bands = mix(vec3(1.0), cool, 0.35) * (dome * 0.3 + blob * 0.8);
  } else {
    float t1 = smoothstep(0.045, 0.01, abs(y - 0.32)) * smoothstep(0.95, 0.3, abs(x));
    float t2 = smoothstep(0.04, 0.008, abs(y + 0.22)) * smoothstep(0.9, 0.2, abs(x - 0.1));
    float t3 = smoothstep(0.035, 0.006, abs(x + 0.4)) * smoothstep(0.9, 0.0, abs(y));
    bands = (warm * t1 + deep * t2 + cool * t3) * 1.5;
  }
  // Sombre : lumière ajoutée sur le noir. Clair : bandes teintées sur blanc cassé (le verre filtre la lumière).
  vec3 darkEnv = bands * 1.25 + uBg2 * 0.4;
  float m = clamp(max(max(bands.r, bands.g), bands.b) * 0.85, 0.0, 1.0);
  vec3 tint = bands / max(max(max(bands.r, bands.g), bands.b), 1e-3);
  vec3 lightEnv = mix(vec3(0.95), clamp(mix(vec3(0.55), tint, 0.85), 0.0, 1.0), m);
  return mix(lightEnv, darkEnv, uDark);
}
`;

/* Fond dessiné par le kit, ancré au document (défile avec la page) et répété en miroir. */
export const FRAG_BACKDROP = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uVp;       // taille de la bande
uniform float uOriginY; // position de la bande dans le document
uniform float uTileH;   // hauteur d'une tuile du fond
uniform float uDocH;
uniform float uTime;
uniform float uAmb;
uniform int uMode;      // 0 environnement, 1 dégradé, 2 image
uniform float uDark;
uniform vec3 uBg;
uniform vec3 uBg2;
uniform vec3 uGlueC;
uniform vec3 uGlowC;
uniform vec3 uGlassC;
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uAngle;
uniform sampler2D uImg;
uniform float uImgAspect;
${COMMON}
void main() {
  float x = vUv.x * uVp.x;
  float docY = uOriginY + (1.0 - vUv.y) * uVp.y;
  float ty = docY / uTileH;
  float tyM = 1.0 - abs(fract(ty * 0.5) * 2.0 - 1.0);   // tuile en miroir : aucune couture
  vec2 uv = vec2(vUv.x, tyM);
  float asp = uVp.x / uTileH;
  vec2 q = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
  vec3 col;
  if (uMode == 2) {
    vec2 s = vec2(1.0);
    if (asp > uImgAspect) s.y = uImgAspect / asp; else s.x = asp / uImgAspect;
    col = texture(uImg, (vec2(uv.x, 1.0 - uv.y) - 0.5) * s + 0.5).rgb;
  } else if (uMode == 1) {
    vec2 dq = vec2(vUv.x, clamp(docY / max(uDocH, 1.0), 0.0, 1.0)) - 0.5;
    float t = clamp(dot(dq, vec2(cos(uAngle), sin(uAngle))) + 0.5, 0.0, 1.0);
    col = mix(uC1, uC2, t);
  } else if (uMode == 3) {
    col = uBg;  // fond uni : noir / blanc cassé, ou couleur personnalisée
  } else {
    float vign = smoothstep(1.3, 0.0, length(q * vec2(0.8, 1.0)));
    col = mix(uBg, uBg2, vign * 0.8);
    float k = mix(0.3, 0.13, uDark);
    col += uGlueC * smoothstep(0.8, 0.0, length(q - vec2(-0.4 * asp, -0.3))) * k;
    col += uGlowC * smoothstep(0.7, 0.0, length(q - vec2(0.45 * asp, -0.05))) * k * 0.7;
    col += uGlassC * smoothstep(0.85, 0.0, length(q - vec2(0.05, 0.55))) * k * 0.55;
    // Faisceaux de lumière nets et obliques (matière à réfracter), teintés par le thème.
    float d1 = q.x * 0.82 + q.y * 0.57;
    float s1 = smoothstep(0.035, 0.0, 0.5 - abs(fract(d1 * 1.5 + 0.12) - 0.5));
    float s2 = smoothstep(0.012, 0.0, 0.5 - abs(fract(d1 * 3.3 + 0.57) - 0.5));
    float s3 = smoothstep(0.12, 0.0, 0.5 - abs(fract(d1 * 0.8 + 0.3) - 0.5)) * 0.35;
    vec3 warm = mix(uGlueC, uGlowC, 0.5) * 1.2;
    vec3 cool = uGlassC;
    col += (cool * s1 + warm * s2 * 0.8 + cool * s3) * mix(0.1, 0.2, uDark);
    col += (vnoise(q * 3.0 + 4.0) - 0.5) * 0.02;
  }
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;

export const FRAG_BLIT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }
`;

/* Matière : verre optique à dispersion + gluant visqueux + glow. */
export const FRAG_ITEM = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPx;
out vec4 o;

uniform vec2 uVp;
uniform vec4 uBounds;
uniform float uTime;
uniform float uAmb;
uniform vec4 uBox;      // cx, cy, w, h
uniform vec4 uRad;      // tl, tr, br, bl (signés)
uniform float uEll;
uniform float uPathMix;
uniform sampler2D uPath;
uniform vec3 uBlob[${MAX_BLOBS}];
uniform int uNBlob;
uniform float uK;
uniform vec4 uNbr[2];
uniform vec2 uNbrR;
uniform int uNNbr;
uniform float uKN;
uniform vec3 uGlue;
uniform vec3 uGlass;
uniform vec3 uGlow;
uniform vec4 uMatA;     // glue, glow, refraction, dispersion
uniform vec4 uMatB;     // specular, fresnel, thickness, grain
uniform vec4 uMatC;     // frost, iridescence, alpha, variant (0 plat, 1 relief, 2 creux)
uniform vec4 uMatD;     // brightness (luminosité), -, -, -
uniform float uSeed;    // graine propre à l'élément : phases et vitesses décalées
uniform vec4 uPtr;      // x, y, creux, appui
uniform vec4 uRip;      // x, y, temps depuis l'impact, amplitude
uniform sampler2D uBack;
${COMMON}
${ENV}

float smaxf(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 1e-4);
  return max(a, b) + h * h * k * 0.25;
}
float sminf(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 1e-4);
  return min(a, b) - h * h * k * 0.25;
}
float sdRect(vec2 p, vec2 hs, vec4 r) {
  float rc = p.x > 0.0 ? (p.y > 0.0 ? r.z : r.y) : (p.y > 0.0 ? r.w : r.x);
  rc = max(rc, 0.0);
  vec2 q = abs(p) - hs + rc;
  float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rc;
  // Coins concaves : disque retiré, raccords arrondis (pas de pointes).
  if (r.x < 0.0) d = smaxf(d, -r.x - length(p - vec2(-hs.x, -hs.y)), min(-r.x * 0.55, 16.0));
  if (r.y < 0.0) d = smaxf(d, -r.y - length(p - vec2(hs.x, -hs.y)), min(-r.y * 0.55, 16.0));
  if (r.z < 0.0) d = smaxf(d, -r.z - length(p - vec2(hs.x, hs.y)), min(-r.z * 0.55, 16.0));
  if (r.w < 0.0) d = smaxf(d, -r.w - length(p - vec2(-hs.x, hs.y)), min(-r.w * 0.55, 16.0));
  return d;
}
float sdEll(vec2 p, vec2 ab) {
  float k = length(p / ab);
  float g = length(p / (ab * ab));
  return g > 1e-6 ? k * (k - 1.0) / g : -min(ab.x, ab.y);
}
float field(vec2 px) {
  vec2 p = px - uBox.xy;
  vec2 hs = uBox.zw * 0.5;
  float d = sdRect(p, hs, uRad);
  if (uEll > 0.001) d = mix(d, sdEll(p, hs), uEll);
  if (uPathMix > 0.001) {
    vec2 uv = p / uBox.zw + 0.5;
    vec2 uc = clamp(uv, 0.0, 1.0);
    float dp = (texture(uPath, uc).r - 0.5) * 32.0 * (max(uBox.z, uBox.w) / 128.0);
    dp += length((uv - uc) * uBox.zw);
    d = mix(d, dp, uPathMix);
  }
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= uNBlob) break;
    d = sminf(d, length(px - uBlob[i].xy) - uBlob[i].z, uK);
  }
  for (int i = 0; i < 2; i++) {
    if (i >= uNNbr) break;
    vec4 nb = uNbr[i];
    d = sminf(d, sdRect(px - nb.xy, nb.zw * 0.5, vec4(i == 0 ? uNbrR.x : uNbrR.y)), uKN);
  }
  return d;
}

// Profil du relief : continu en pente et en courbure à la fin du chanfrein (aucune ligne parasite).
float profile(float d, float bw, float th, float e) {
  float t = clamp(-d / max(bw, 1.0), 0.0, 1.0);
  return th * (1.0 - pow(1.0 - t, e));
}
// Écoulement visqueux, lent : n'agit qu'à l'intérieur (les bords restent fixes).
float flowH(vec2 px, float amp, float mask) {
  float t = uTime * 0.09 * (0.8 + 0.4 * uSeed) + uSeed * 21.0;
  float n = vnoise(px * 0.012 + vec2(t, -t * 0.8)) + 0.55 * vnoise(px * 0.029 - vec2(t * 0.9, t * 1.2)) - 0.78;
  return amp * mask * n;
}
float heightAt(vec2 px, float th, float bw, float e, float sgn, float flowAmp) {
  float dd = field(px);
  float h = profile(dd, bw, th, e) * sgn;
  h += flowH(px, flowAmp, smoothstep(0.0, bw * 0.9, -dd));
  vec2 dp = px - uPtr.xy;
  float sig = clamp(min(uBox.z, uBox.w) * 0.35, 22.0, 90.0);
  h -= uPtr.z * th * 0.95 * exp(-dot(dp, dp) / (2.0 * sig * sig));
  if (uRip.w > 0.0) {
    vec2 rp = px - uRip.xy;
    float r = length(rp);
    h += uRip.w * th * 0.3 * sin(r * 0.17 - uRip.z * 15.0) * exp(-uRip.z * 2.8) * exp(-r * 0.012);
  }
  return h;
}

vec2 uvOf(vec2 p) { return vec2(p.x / uVp.x, 1.0 - p.y / uVp.y); }

// Interférences en couches minces (huile sur l'eau), recolorées avec les teintes du thème.
vec3 thinFilm(float ph) {
  float t = fract(ph) * 4.0;
  vec3 c0 = uGlueC, c1 = uGlowC, c2 = uGlassC, c3 = vec3(0.95);
  vec3 c = t < 1.0 ? mix(c0, c1, smoothstep(0.0, 1.0, t))
         : t < 2.0 ? mix(c1, c2, smoothstep(0.0, 1.0, t - 1.0))
         : t < 3.0 ? mix(c2, c3, smoothstep(0.0, 1.0, t - 2.0))
                   : mix(c3, c0, smoothstep(0.0, 1.0, t - 3.0));
  vec3 spectral = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ph));
  return mix(c, spectral, 0.3) * 1.15;
}
// Épaisseur du film : champ visqueux déformé, qui dérive très lentement.
float oilField(vec2 px, float t) {
  vec2 q = px * 0.0055;
  vec2 w = vec2(vnoise(q * 1.6 + vec2(t * 0.9, 0.0)), vnoise(q * 1.6 + vec2(5.2, -t * 0.8)));
  q += (w - 0.5) * 1.7;
  return vnoise(q * 2.0 + vec2(-t * 0.6, t * 0.4)) + 0.5 * vnoise(q * 4.3 + vec2(t * 0.5, -t * 0.7));
}

void main() {
  float variant = uMatC.w;
  float d = field(vPx);
  float cov = smoothstep(0.8, -0.8, d);

  float glue = clamp(uMatA.x, 0.0, 1.0), glowK = uMatA.y;
  float th = uMatB.z * (variant < 0.5 ? 0.35 : 1.0) * mix(1.0, 1.5, glue);
  float minHalf = 0.5 * min(uBox.z, uBox.w);
  float bw = mix(th, clamp(minHalf * 0.9, th, th * 1.9), glue);
  float ex = mix(3.8, 3.1, glue);
  float sgn = variant > 1.5 ? -0.7 : 1.0;
  float flowAmp = uAmb * th * 0.2 * (0.3 + 0.7 * glue);

  float shadow = 0.0;
  if (variant > 0.5 && variant < 1.5 && cov < 0.999) {
    float ds0 = field(vPx - vec2(0.0, 9.0));
    shadow = (1.0 - smoothstep(-8.0, 34.0, ds0)) * mix(0.14, 0.34, uDark) * smoothstep(16.0, 48.0, min(uBox.z, uBox.w));
  }

  float haloR = 8.0 + 30.0 * glowK;
  float bfade = smoothstep(0.0, 44.0, min(min(vPx.x - uBounds.x, uBounds.x + uBounds.z - vPx.x), min(vPx.y - uBounds.y, uBounds.y + uBounds.w - vPx.y)));
  float halo = exp(-max(d, 0.0) / haloR) * glowK * 0.55 * bfade * uDark;

  vec3 col = vec3(0.0);
  if (cov > 0.002) {
    bool deepFlat = d < -bw * 1.05 && uPtr.z < 0.002 && uRip.w <= 0.0;
    float h0 = heightAt(vPx, th, bw, ex, sgn, flowAmp);
    vec2 g;
    if (deepFlat) {
      g = vec2(flowH(vPx + vec2(1.0, 0.0), flowAmp, 1.0) - flowH(vPx, flowAmp, 1.0), flowH(vPx + vec2(0.0, 1.0), flowAmp, 1.0) - flowH(vPx, flowAmp, 1.0));
    } else {
      g = vec2(heightAt(vPx + vec2(1.0, 0.0), th, bw, ex, sgn, flowAmp) - h0, heightAt(vPx + vec2(0.0, 1.0), th, bw, ex, sgn, flowAmp) - h0);
    }
    float grain = uMatB.w;
    float dirN = vnoise(vec2(dot(vPx, vec2(0.83, 0.55)) * 0.55, floor(dot(vPx, vec2(-0.55, 0.83)) * 0.06) * 7.7));
    float scr = smoothstep(0.88, 0.985, dirN) * grain * 0.6;
    float dust = step(0.9994, hash21(floor(vPx * 0.7))) * grain;
    g += (vnoise(vPx * 0.9) - 0.5) * 0.04 * grain + vec2(scr * 0.14, -scr * 0.08);
    vec3 n = normalize(vec3(-g, 1.0));

    float depth = clamp(h0 / max(th, 1.0), 0.0, 1.0);
    float lens = smoothstep(0.03, 0.5, 1.0 - n.z);
    float refr = uMatA.z, disp = uMatA.w * (variant < 0.5 ? 0.4 : 1.0);
    float frost = uMatC.x;
    // Chaque élément a sa propre phase, sa vitesse et son sens : rien ne pulse en même temps.
    float sp = 0.7 + 0.6 * uSeed;
    float dirS = uSeed > 0.5 ? 1.0 : -1.0;
    float ang = dirS * (uTime * 0.16 * uAmb * sp) + uSeed * 6.2831;
    float tOil = uTime * 0.05 * uAmb * sp + uSeed * 37.0;

    // Transmission : le fond est réfracté, avec une dispersion prononcée par canal.
    vec2 off = -n.xy * th * refr * 2.2;
    float lod = frost * 4.0;
    vec3 tr;
    tr.r = textureLod(uBack, uvOf(vPx + off * (1.0 - disp * 0.55)), lod).r;
    tr.g = textureLod(uBack, uvOf(vPx + off), lod).g;
    tr.b = textureLod(uBack, uvOf(vPx + off * (1.0 + disp * 0.55)), lod).b;

    // Lumière traversant le chanfrein : bandes prismatiques, séparées par canal (indices différents).
    vec3 envT = vec3(0.0);
    if (lens > 0.01) {
      vec3 v = vec3(0.0, 0.0, -1.0);
      vec3 t0 = refract(v, n, 1.0 / (1.5 - disp * 0.09));
      vec3 t1 = refract(v, n, 1.0 / 1.5);
      vec3 t2 = refract(v, n, 1.0 / (1.5 + disp * 0.09));
      if (dot(t0, t0) < 0.01) t0 = reflect(v, n);
      if (dot(t1, t1) < 0.01) t1 = reflect(v, n);
      if (dot(t2, t2) < 0.01) t2 = reflect(v, n);
      envT = vec3(envLight(rotY(normalize(t0), ang)).r, envLight(rotY(normalize(t1), ang)).g, envLight(rotY(normalize(t2), ang)).b);
    }

    // Corps : verre clair ; le gluant est teinté en volume (plus dense au centre).
    float lightG = 0.35 + 1.3 * uMatD.x;   // luminosité : réglage à part, indépendant du gluant
    vec3 liquid = mix(uGlass, uGlue, clamp(glue * 1.1, 0.0, 1.0));
    float lumL = max(dot(liquid, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    // La luminance de la teinte est fixée par la luminosité ; le gluant ne change que sa teinte et sa densité.
    vec3 liquidN = liquid / lumL * mix(0.55 + 0.35 * uMatD.x, 0.08 + 0.3 * uMatD.x, uDark);
    float absorb = mix(0.08, 0.4, glue) * (0.3 + 0.7 * depth) + (variant > 1.5 ? 0.05 : 0.0);
    vec3 body = mix(tr, liquidN, absorb);
    body = mix(body, mix(uBg, uBg2, 0.35), mix(0.08, 0.14, uDark));

    // Réflexions du banc d'optique (franges séparées par canal).
    vec3 rf = reflect(vec3(0.0, 0.0, -1.0), n);
    rf = normalize(rf + vec3((vPx - 0.5 * uVp) / 900.0 * 0.5, 0.0));
    float ds = disp * 0.11;
    vec3 env = vec3(envLight(rotY(normalize(rf + vec3(-ds, 0.0, 0.0)), ang)).r, envLight(rotY(rf, ang)).g, envLight(rotY(normalize(rf + vec3(ds, 0.0, 0.0)), ang)).b);
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);
    float specK = uMatB.x * (0.16 + 1.15 * fres) + uMatB.y * fres * 0.8;
    vec3 spec = env * specK * (variant > 1.5 ? 0.5 : 1.0);

    // Gloss visqueux : deux lobes dont la lumière dérive ; suit le pointeur au survol.
    float hov = clamp(uPtr.z * 1.6 + uPtr.w * 0.5, 0.0, 1.0);
    vec2 toP = (uPtr.xy - vPx) / max(max(uBox.z, uBox.w), 40.0);
    vec2 drift = uAmb * vec2(sin(uTime * 0.23 * sp + uSeed * 6.28), cos(uTime * 0.17 * sp + uSeed * 9.1)) * 0.3;
    vec3 L1 = normalize(mix(vec3(-0.5 + drift.x, -0.6 + drift.y, 0.66), vec3(toP * 1.4, 0.75), hov));
    vec3 H1 = normalize(L1 + vec3(0.0, 0.0, 1.0));
    vec3 L2 = normalize(vec3(0.55 - drift.y, 0.5, 0.7));
    vec3 H2 = normalize(L2 + vec3(0.0, 0.0, 1.0));
    float wet = (pow(max(dot(n, H1), 0.0), mix(70.0, 150.0, glue)) * 1.5 + pow(max(dot(n, H1), 0.0), 16.0) * 0.2 + pow(max(dot(n, H2), 0.0), 60.0) * 0.4) * 0.6 * uMatB.x;

    // Huile sur l'eau : film mince visqueux, bandes colorées aux couleurs du thème qui dérivent lentement.
    float irid = uMatC.y;
    float th2 = oilField(vPx, tOil);
    float ph = th2 * 1.5 + (1.0 - n.z) * 0.9;
    float bandI = pow(0.5 + 0.5 * sin(6.2831 * ph + 1.0), 1.5);
    vec3 filmC = thinFilm(ph * 0.55 + 0.1);
    float inner = 0.4 + 0.6 * smoothstep(0.0, bw * 0.7, -d);
    float filmW = irid * bandI * (inner * 0.3 + lens * 0.95);

    // Sombre : la lumière s'ajoute sur le noir. Clair : le verre filtre le blanc cassé.
    // Lumière ajoutée (compressée en douceur : pas de blanc écrasé, les teintes de dispersion restent saturées).
    vec3 addD = (envT * lens * refr * 0.85 + spec * 0.75 + vec3(wet) + filmC * filmW * 0.6) * lightG;
    vec3 colD = body + (1.0 - exp(-addD * 1.35));
    vec3 colL = body * mix(vec3(1.0), envT, clamp(lens * refr * lightG, 0.0, 1.0));
    colL = mix(colL, env, clamp(specK * 0.4 * lightG, 0.0, 0.8));
    colL *= mix(vec3(1.0), mix(vec3(1.0), filmC, 0.85), clamp(filmW * 0.7 * lightG, 0.0, 0.6));
    colL = colL * (1.0 - 0.22 * lens) + vec3(wet) * 0.3 - vec3(dust) * 0.2;
    col = mix(colL, colD, uDark);
    col += mix(0.0, 1.0, uDark) * (dust * 0.5 + scr * 0.14 * (0.3 + fres));

    col += uGlow * glowK * 0.14 * pow(1.0 - depth, 5.0) * uDark;
    if (variant > 1.5) col *= mix(0.78, 1.0, smoothstep(0.0, 0.6, depth));
    col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  }

  float a = uMatC.z;
  vec3 rgb = col * cov;
  float alpha = cov;
  float outside = 1.0 - cov;
  rgb += uGlow * halo * outside;
  alpha = alpha + halo * 0.5 * outside;
  alpha = alpha + shadow * outside * bfade * (1.0 - alpha);
  o = vec4(rgb, min(alpha, 1.0)) * a;
}
`;
