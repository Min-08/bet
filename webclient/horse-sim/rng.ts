// Deterministic, seedable PRNG helpers (mulberry32) + small math utilities.
// Usage:
//   const rng = createRng("seed123");
//   rng.nextFloat(); // 0..1
//   rng.normal(1, 0.05); // normal(1,0.05) sample
//
// Seeds can be number or string; strings are hashed to 32-bit.

export type Seed = number | string | undefined;

export type Rng = {
  next: () => number; // uint32
  nextFloat: () => number; // [0,1)
  nextRange: (min: number, max: number) => number; // float in [min,max)
  nextInt: (min: number, max: number) => number; // int inclusive
  normal: (mean?: number, std?: number) => number;
};

const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) >>> 0;
  };
  const nextFloat = () => next() / 4294967296;
  const nextRange = (min: number, max: number) => min + (max - min) * nextFloat();
  const nextInt = (min: number, max: number) => Math.floor(nextRange(min, max + 1));
  const normal = (mean = 0, std = 1) => {
    // Box-Muller; reuse single pass for simplicity (determinism over performance)
    let u = 0;
    let v = 0;
    while (u === 0) u = nextFloat();
    while (v === 0) v = nextFloat();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z = mag * Math.cos(2.0 * Math.PI * v);
    return mean + z * std;
  };
  return { next, nextFloat, nextRange, nextInt, normal };
};

// djb2-like hash for strings/numbers to 32-bit seed
export const hashSeed = (base: Seed, salt: number | string = 0): number => {
  const s = `${base ?? ""}:${salt}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
};

export const createRng = (seed: Seed): Rng => mulberry32(hashSeed(seed ?? 1, "rng"));

// Small helpers shared across modules
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

