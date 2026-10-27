// Procedural surface details injected into standard Three.js materials.
// No textures to download: patterns are computed from world coordinates.
//   - facades: a window grid per storey on every vertical wall
//   - sett:    a cobblestone pattern for streets tagged surface=sett
import * as THREE from "three";
import { LEVEL_UNITS } from "./geo";

const VERTEX_DECL = /* glsl */ `
varying vec3 vGpWorldPos;
varying vec3 vGpWorldNormal;
`;
const VERTEX_BODY = /* glsl */ `
vGpWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGpWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

function injectWorldVaryings(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + VERTEX_DECL)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERTEX_BODY);
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\n" + VERTEX_DECL);
}

// ── facades ────────────────────────────────────────────────────────────────

// Storeys are counted from each building's own ground floor (attribute aBase).
const FACADE_VERTEX_DECL = "attribute float aBase;\nvarying float vGpBase;";
const FACADE_VERTEX_BODY = "vGpBase = aBase;";

const facadeUniforms = {
  uLevel: { value: LEVEL_UNITS },
  uWinSpacing: { value: 1.25 }, // ≈ 2.7 m between windows
  uLitRatio: { value: 0.0 },
  uLitStrength: { value: 0.0 },
};

const FACADE_FRAGMENT = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 n = normalize(vGpWorldNormal);
  if (abs(n.y) < 0.3) {
    vec2 t = normalize(vec2(-n.z, n.x));
    float s = dot(vGpWorldPos.xz, t) / uWinSpacing;
    float f = (vGpWorldPos.y - vGpBase) / uLevel - 0.12;
    vec2 cell = vec2(fract(s), fract(f));
    vec2 fw = fwidth(vec2(s, f));
    float wx = smoothstep(0.28 - fw.x, 0.28 + fw.x, cell.x) * (1.0 - smoothstep(0.72 - fw.x, 0.72 + fw.x, cell.x));
    float wy = smoothstep(0.30 - fw.y, 0.30 + fw.y, cell.y) * (1.0 - smoothstep(0.80 - fw.y, 0.80 + fw.y, cell.y));
    float mask = wx * wy * step(0.0, floor(f));
    // Far away the grid would shimmer – fade to its average instead.
    mask = mix(mask, 0.2, smoothstep(0.18, 0.45, max(fw.x, fw.y)));
    float h = fract(sin(dot(vec3(floor(s), floor(f), floor(dot(vGpWorldPos.xz, vec2(n.x, n.z)) * 2.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.11, 0.14), mask * 0.85);
    float lit = step(1.0 - uLitRatio, h);
    vec3 glow = mix(vec3(1.0, 0.62, 0.25), vec3(0.65, 0.4, 1.0), step(0.88, fract(h * 7.0)));
    totalEmissiveRadiance += glow * mask * lit * uLitStrength;
  }
}
`;

export function applyFacadeShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, facadeUniforms);
    injectWorldVaryings(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + FACADE_VERTEX_DECL)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + FACADE_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGpBase;\nuniform float uLevel;\nuniform float uWinSpacing;\nuniform float uLitRatio;\nuniform float uLitStrength;")
      .replace("#include <emissivemap_fragment>", FACADE_FRAGMENT);
  };
  material.customProgramCacheKey = () => "gp-facade";
}

/** Share of windows that glow, and how strongly. */
export function setFacadeLights(ratio: number, strength: number) {
  facadeUniforms.uLitRatio.value = ratio;
  facadeUniforms.uLitStrength.value = strength;
}

/** Ghost Mode: many glowing windows; off restores daylight (no lit windows). */
export function setFacadeNight(on: boolean) {
  setFacadeLights(on ? 0.14 : 0.0, on ? 1.8 : 0.0);
}

// ── cobblestones ───────────────────────────────────────────────────────────

const settUniforms = { uStone: { value: 0.12 } }; // ≈ 26 cm stones

const SETT_FRAGMENT = /* glsl */ `
#include <color_fragment>
{
  vec2 p = vGpWorldPos.xz / uStone;
  p.x += mod(floor(p.y), 2.0) * 0.5;
  vec2 cell = fract(p) - 0.5;
  vec2 fw = fwidth(p);
  float edge = max(abs(cell.x), abs(cell.y) * 1.15);
  float joint = smoothstep(0.40 - fw.x, 0.40 + fw.x, edge);
  float h = fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
  float detail = 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
  diffuseColor.rgb *= mix(1.0, (0.84 + 0.28 * h) * (1.0 - 0.45 * joint), detail);
}
`;

export function applySettShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, settUniforms);
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uStone;")
      .replace("#include <color_fragment>", SETT_FRAGMENT);
  };
  material.customProgramCacheKey = () => "gp-sett";
}
