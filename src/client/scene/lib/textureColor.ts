import { Color } from 'three'

// Cache by texture path so each image is sampled only once across all planets.
const cache = new Map<string, Color>()

/**
 * Derives a believable atmosphere tint from a planet's surface texture by
 * averaging its pixels, then desaturating + lightening the result.
 *
 * Averaging the equirectangular map gives the planet's dominant hue (icy
 * maps → pale blue-grey, desert → tan, lava → red, ocean → blue), and the
 * desaturate/lighten step turns that into a soft atmospheric glow colour
 * rather than the saturated surface colour — so an icy planet reads as
 * light grey, never pink.
 */
export function atmosphereColorFromImage(
  key: string,
  image: CanvasImageSource,
): Color {
  const cached = cache.get(key)
  if (cached) return cached.clone()

  const w = 32
  const h = 16
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const col = new Color(0.7, 0.75, 0.8) // neutral fallback

  if (ctx) {
    try {
      ctx.drawImage(image, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        // Ignore fully transparent pixels (texture maps are opaque, but be safe).
        if (data[i + 3]! === 0) continue
        r += data[i]!
        g += data[i + 1]!
        b += data[i + 2]!
        n++
      }
      if (n > 0) {
        col.setRGB(r / n / 255, g / n / 255, b / n / 255)
        const hsl = { h: 0, s: 0, l: 0 }
        col.getHSL(hsl)
        // Soften saturation and push toward a light, hazy lightness.
        col.setHSL(hsl.h, Math.min(hsl.s * 0.65, 0.55), Math.min(0.55 + hsl.l * 0.3, 0.82))
      }
    } catch {
      // Tainted canvas / decode failure — keep the neutral fallback.
    }
  }

  cache.set(key, col)
  return col.clone()
}
