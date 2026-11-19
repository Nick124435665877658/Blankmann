// Bildaufbereitung für Kassenbons.
// Ein globaler Schwellenwert (Kontrast/Otsu) scheitert bei Knitterfalten und ungleichem Licht:
// Preise in beschatteten Bereichen gehen verloren. Hier wird der Papierhintergrund geschätzt
// und herausgeteilt, so dass die Schrift überall gleich dunkel erscheint.

function filterAxis(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, horizontal: boolean, pickMax: boolean) {
  const len = horizontal ? w : h
  const lines = horizontal ? h : w
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - r)
      const hi = Math.min(len - 1, i + r)
      let v = pickMax ? 0 : 255
      for (let k = lo; k <= hi; k++) {
        const s = src[horizontal ? l * w + k : k * w + l]
        if (pickMax ? s > v : s < v) v = s
      }
      dst[horizontal ? l * w + i : i * w + l] = v
    }
  }
}

function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Float32Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    let count = 0
    for (let x = 0; x < Math.min(w, r + 1); x++) { sum += src[y * w + x]; count++ }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / count
      const add = x + r + 1
      const rem = x - r
      if (add < w) { sum += src[y * w + add]; count++ }
      if (rem >= 0) { sum -= src[y * w + rem]; count-- }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    let count = 0
    for (let y = 0; y < Math.min(h, r + 1); y++) { sum += tmp[y * w + x]; count++ }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / count)
      const add = y + r + 1
      const rem = y - r
      if (add < h) { sum += tmp[add * w + x]; count++ }
      if (rem >= 0) { sum -= tmp[rem * w + x]; count-- }
    }
  }
  return out
}

// Graustufenbild -> Graustufenbild mit ausgeglichener Beleuchtung (gleiche Größe).
export function normalizeIllumination(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const factor = Math.max(1, Math.round(Math.max(width, height) / 600))
  const sw = Math.ceil(width / factor)
  const sh = Math.ceil(height / factor)
  const small = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0
      let n = 0
      for (let dy = 0; dy < factor; dy++) {
        const yy = y * factor + dy
        if (yy >= height) break
        for (let dx = 0; dx < factor; dx++) {
          const xx = x * factor + dx
          if (xx >= width) break
          sum += gray[yy * width + xx]
          n++
        }
      }
      small[y * sw + x] = Math.round(sum / n)
    }
  }
  // Schließen (Maximum, dann Minimum) entfernt dunkle Schrift und lässt das Papier übrig.
  const radius = Math.max(3, Math.round((Math.max(width, 600) * 0.04) / factor / 2))
  const a = new Uint8Array(sw * sh)
  const b = new Uint8Array(sw * sh)
  filterAxis(small, a, sw, sh, radius, true, true)
  filterAxis(a, b, sw, sh, radius, false, true)
  filterAxis(b, a, sw, sh, radius, true, false)
  filterAxis(a, b, sw, sh, radius, false, false)
  const background = boxBlur(b, sw, sh, Math.max(2, Math.round(radius / 2)))
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / factor - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / factor - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const top = background[y0 * sw + x0] * (1 - tx) + background[y0 * sw + x1] * tx
      const bottom = background[y1 * sw + x0] * (1 - tx) + background[y1 * sw + x1] * tx
      const paper = Math.max(1, top * (1 - ty) + bottom * ty)
      out[y * width + x] = Math.round((gray[y * width + x] * 255) / paper)
    }
  }
  return out
}

export async function prepareReceiptImages(file: Blob): Promise<{ label: string; blob: Blob }[]> {
  let bitmap: ImageBitmap
  try {
    // Foto-Ausrichtung (EXIF) ausdrücklich übernehmen, damit der Bon aufrecht gelesen wird.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  const scale = Math.max(0.75, Math.min(2.2, 1800 / bitmap.width, 6500 / bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) { bitmap.close(); return [{ label: 'Original', blob: file }] }
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const source = ctx.getImageData(0, 0, width, height)
  const gray = new Uint8ClampedArray(width * height)
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    gray[p] = Math.round(0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2])
  }
  const flat = normalizeIllumination(gray, width, height)
  const result = ctx.createImageData(width, height)
  for (let p = 0, i = 0; p < flat.length; p++, i += 4) {
    result.data[i] = result.data[i + 1] = result.data[i + 2] = flat[p]
    result.data[i + 3] = 255
  }
  ctx.putImageData(result, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => (value ? resolve(value) : reject(new Error('Bild konnte nicht vorbereitet werden.'))), 'image/png')
  })
  return [{ label: 'Lichtausgleich', blob }]
}
