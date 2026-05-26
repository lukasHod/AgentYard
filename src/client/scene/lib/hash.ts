// FNV-1a 32-bit string hash — fast, dependency-free, deterministic.
export function hashStringToInt(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/** Pull a byte at position i from a 32-bit hash (4 bytes). Returns 0..255. */
export function hashByte(h: number, i: number): number {
  return (h >>> (i * 8)) & 0xff
}

/** Combine two seeds to get a derived hash that's stable but distinct. */
export function deriveHash(seed: number, salt: string): number {
  return hashStringToInt(salt + seed.toString(16))
}
