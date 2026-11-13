export interface BorderInfo {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Detect black borders in an ImageData.
 * Returns the number of pixels to crop from each side.
 */
export function detectBlackBorders(
  imageData: ImageData,
  brightnessThreshold = 25,
  darkPixelRatio = 0.90
): BorderInfo {
  const { width, height, data } = imageData

  function rowBrightness(y: number): number {
    let totalBrightness = 0
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      totalBrightness += (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    }
    return totalBrightness / width
  }

  function isRowDark(y: number): boolean {
    let darkCount = 0
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      if (brightness < brightnessThreshold) darkCount++
    }
    return darkCount / width >= darkPixelRatio
  }

  function isColDark(x: number): boolean {
    let darkCount = 0
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      if (brightness < brightnessThreshold) darkCount++
    }
    return darkCount / height >= darkPixelRatio
  }

  // Check average brightness of entire image - if generally dark, don't crop
  let totalBright = 0
  for (let y = 0; y < height; y += 4) {
    totalBright += rowBrightness(y)
  }
  const avgBright = totalBright / (height / 4)
  if (avgBright < 50) {
    // Dark image overall - skip border detection
    return { top: 0, bottom: 0, left: 0, right: 0 }
  }

  // Max crop is 30% of dimension to avoid false positives
  const maxTopBottom = Math.floor(height * 0.3)
  const maxLeftRight = Math.floor(width * 0.2)

  let top = 0
  while (top < maxTopBottom && isRowDark(top)) top++

  let bottom = 0
  while (bottom < maxTopBottom && isRowDark(height - 1 - bottom)) bottom++

  let left = 0
  while (left < maxLeftRight && isColDark(left)) left++

  let right = 0
  while (right < maxLeftRight && isColDark(width - 1 - right)) right++

  return { top, bottom, left, right }
}

/**
 * Remove black borders from an ImageBitmap.
 * Returns the cropped bitmap and detected border sizes.
 */
export async function removeBlackBorders(
  bitmap: ImageBitmap
): Promise<{ bitmap: ImageBitmap; borders: BorderInfo }> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  const borders = detectBlackBorders(imageData)

  const cropW = bitmap.width - borders.left - borders.right
  const cropH = bitmap.height - borders.top - borders.bottom

  if (cropW <= 0 || cropH <= 0 || (borders.top === 0 && borders.bottom === 0 && borders.left === 0 && borders.right === 0)) {
    return { bitmap, borders }
  }

  const cropped = new OffscreenCanvas(cropW, cropH)
  const ctx2 = cropped.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx2.drawImage(bitmap, borders.left, borders.top, cropW, cropH, 0, 0, cropW, cropH)

  const newBitmap = await createImageBitmap(cropped)
  return { bitmap: newBitmap, borders }
}
