/**
 * Small deterministic PRNG so ladders are reproducible per seed on every platform.
 * Not cryptographic; nothing here needs to be.
 */

/** FNV-1a 32-bit over a string, so string seeds and labels map to a 32-bit state. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Any seed (number or string) plus a label becomes one 32-bit state. Different labels give independent streams. */
export function seedState(seed: number | string, label = ""): number {
  return hash32(`${typeof seed}:${String(seed)}|${label}`);
}

/** mulberry32: returns a function yielding floats in [0, 1). */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` lowercase hex characters drawn from `rng`. */
export function hexFrom(rng: () => number, n: number): string {
  let out = "";
  while (out.length < n) {
    out += Math.floor(rng() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  }
  return out.slice(0, n);
}

/** A UUID v4-shaped id (version and variant bits set) derived from a seed and a label. */
export function uuidFrom(seed: number | string, label: string): string {
  const hex = hexFrom(mulberry32(seedState(seed, label)), 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) & 3] ?? "8";
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
