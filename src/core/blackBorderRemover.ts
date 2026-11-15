export interface BorderInfo {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * 高精度全分辨率黑边与过渡边缘检测：
 * 1. 彻底切除播放器黑边、状态栏黑条；
 * 2. 精确切除抗锯齿与 JPEG 压缩残存的 1~2 像素过渡灰度线，彻底解决横向黑线问题；
 * 3. 严格保护正文内容（最大检测深度限制在 22% 以内，遇文本行立即停止）。
 */
export function detectBlackBorders(
  imageData: ImageData,
  _brightnessThreshold = 80,
  _darkPixelRatio = 0.75
): BorderInfo {
  const { width, height, data } = imageData
  const maxH = Math.floor(height * 0.22)
  const maxW = Math.floor(width * 0.15)
  const step = 4

  let top = 0
  for (let y = 0; y < maxH; y++) {
    let darkCount = 0
    let sumB = 0
    let samples = 0
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4
      const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      sumB += b
      if (b < 85) darkCount++
      samples++
    }
    const avg = sumB / samples
    if (darkCount / samples > 0.75 || avg < 60) {
      top = y + 1
    } else if (avg < 120 && y === top) {
      // 过渡灰线（JPEG 边界抗锯齿）
      top = y + 1
    } else {
      break
    }
  }

  let bottom = 0
  for (let y = height - 1; y >= height - maxH; y--) {
    let darkCount = 0
    let sumB = 0
    let samples = 0
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4
      const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      sumB += b
      if (b < 85) darkCount++
      samples++
    }
    const avg = sumB / samples
    if (darkCount / samples > 0.75 || avg < 60) {
      bottom = height - y
    } else if (avg < 120 && (height - 1 - y) === bottom) {
      // 过渡灰线（JPEG 边界抗锯齿）
      bottom = height - y
    } else {
      break
    }
  }

  let left = 0
  for (let x = 0; x < maxW; x++) {
    let darkCount = 0
    let sumB = 0
    let samples = 0
    for (let y = top; y < height - bottom; y += step) {
      const idx = (y * width + x) * 4
      const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      sumB += b
      if (b < 85) darkCount++
      samples++
    }
    const avg = sumB / samples
    if (darkCount / samples > 0.80 || avg < 60) {
      left = x + 1
    } else {
      break
    }
  }

  let right = 0
  for (let x = width - 1; x >= width - maxW; x--) {
    let darkCount = 0
    let sumB = 0
    let samples = 0
    for (let y = top; y < height - bottom; y += step) {
      const idx = (y * width + x) * 4
      const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      sumB += b
      if (b < 85) darkCount++
      samples++
    }
    const avg = sumB / samples
    if (darkCount / samples > 0.80 || avg < 60) {
      right = width - x
    } else {
      break
    }
  }

  return { top, bottom, left, right }
}

/**
 * 快速检测黑边并在原图坐标上高保真裁切
 */
export async function removeBlackBorders(
  bitmap: ImageBitmap
): Promise<{ bitmap: ImageBitmap; borders: BorderInfo }> {
  const osc = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0)
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  const borders = detectBlackBorders(imgData)

  const cropW = bitmap.width - borders.left - borders.right
  const cropH = bitmap.height - borders.top - borders.bottom

  if (
    cropW <= 0 ||
    cropH <= 0 ||
    (borders.top === 0 && borders.bottom === 0 && borders.left === 0 && borders.right === 0)
  ) {
    return { bitmap, borders: { top: 0, bottom: 0, left: 0, right: 0 } }
  }

  const cropped = new OffscreenCanvas(cropW, cropH)
  const ctx2 = cropped.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx2.drawImage(bitmap, borders.left, borders.top, cropW, cropH, 0, 0, cropW, cropH)

  const newBitmap = await createImageBitmap(cropped)
  return { bitmap: newBitmap, borders }
}
