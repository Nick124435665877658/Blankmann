// Foto vor dem Hochladen verkleinern (max. 1600 px, JPEG): schneller auf dem Handy, spart Speicher.
// Die Ausrichtung aus dem Kamerafoto (EXIF) wird übernommen. Klappt das Verkleinern nicht, geht das Original hoch.
export async function shrinkImage(file: File, maxSize = 1600, quality = 0.85): Promise<Blob> {
  try {
    let bitmap: ImageBitmap
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { bitmap = await createImageBitmap(file) }
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', quality))
  } catch {
    return file
  }
}
