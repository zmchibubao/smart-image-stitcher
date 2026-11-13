export interface BorderInfo {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * 采样检测黑边，步长 step=4 避免逐像素全遍历，极大提升性能
 */
export function detectBlackBorders(
  imageData: ImageData,
  brightnessThreshold = 25,
  darkPixelRatio = 0.90
): BorderInfo {
  const { width, height, data } = imageData
  const step = 4

  function isRowDark(y: number): boolean {
    let darkCount = 0
    let totalSamples = 0
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      if (brightness < brightnessThreshold) darkCount++
      totalSamples++
    }
    return darkCount / totalSamples >= darkPixelRatio
  }

  function isColDark(x: number): boolean {
    let darkCount = 0
    let totalSamples = 0
    for (let y = 0; y < height; y += step) {
      const idx = (y * width + x) * 4
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      if (brightness < brightnessThreshold) darkCount++
      totalSamples++
    }
    return darkCount / totalSamples >= darkPixelRatio
  }

  const maxTopBottom = Math.floor(height * 0.25)
  const maxLeftRight = Math.floor(width * 0.2)

  let top = 0
  while (top < maxTopBottom && isRowDark(top)) top += step

  let bottom = 0
  while (bottom < maxTopBottom && isRowDark(height - 1 - bottom)) bottom += step

  let left = 0
  while (left < maxLeftRight && isColDark(left)) left += step

  let right = 0
  while (right < maxLeftRight && isColDark(width - 1 - right)) right += step

  return { top, bottom, left, right }
}

/**
 * 快速检测黑边，先在缩放小图上检测，再映射回原图坐标，毫秒级完成
 */
export async function removeBlackBorders(
  bitmap: ImageBitmap
): Promise<{ bitmap: ImageBitmap; borders: BorderInfo }> {
  // 采样缩放到最大 400px 进行黑边分析，极快且避免创建超大 Canvas
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height))
  const sampleW = Math.round(bitmap.width * scale)
  const sampleH = Math.round(bitmap.height * scale)

  const osc = new OffscreenCanvas(sampleW, sampleH)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH)
  const sampleData = ctx.getImageData(0, 0, sampleW, sampleH)

  const smallBorders = detectBlackBorders(sampleData)

  const borders: BorderInfo = {
    top: Math.round(smallBorders.top / scale),
    bottom: Math.round(smallBorders.bottom / scale),
    left: Math.round(smallBorders.left / scale),
    right: Math.round(smallBorders.right / scale),
  }

  const cropW = bitmap.width - borders.left - borders.right
  const cropH = bitmap.height - borders.top - borders.bottom

  if (cropW <= 0 || cropH <= 0 || (borders.top === 0 && borders.bottom === 0 && borders.left === 0 && borders.right === 0)) {
    return { bitmap, borders: { top: 0, bottom: 0, left: 0, right: 0 } }
  }

  const cropped = new OffscreenCanvas(cropW, cropH)
  const ctx2 = cropped.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx2.drawImage(bitmap, borders.left, borders.top, cropW, cropH, 0, 0, cropW, cropH)

  const newBitmap = await createImageBitmap(cropped)
  return { bitmap: newBitmap, borders }
}
