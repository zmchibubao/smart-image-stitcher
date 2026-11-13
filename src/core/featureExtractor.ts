import { loadOpenCV } from '../utils/opencvLoader'
import type { ORBFeatures, KeyPoint } from '../types'

const MAX_FEATURE_SIZE = 800 // pixels - downscale for fast feature extraction

export async function extractORBFeatures(
  bitmap: ImageBitmap,
  imageId: string,
  maxKeypoints = 500
): Promise<ORBFeatures> {
  const cv = await loadOpenCV()

  // Compute scale so we don't exceed MAX_FEATURE_SIZE
  const scale = Math.min(1, MAX_FEATURE_SIZE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  // Draw to offscreen canvas
  const osc = new OffscreenCanvas(w, h)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)

  // Convert to cv.Mat
  const src = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

  // ORB detector - try different API patterns
  let orb: any
  try {
    orb = new cv.ORB(maxKeypoints, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 20)
  } catch {
    try {
      orb = cv.ORB.create(maxKeypoints)
    } catch {
      src.delete(); gray.delete()
      return { keypoints: [], descriptors: [], imageId, scale }
    }
  }

  const mask = new cv.Mat()
  const kpVec = new cv.KeyPointVector()
  const desc = new cv.Mat()

  try {
    orb.detectAndCompute(gray, mask, kpVec, desc)
  } catch (e) {
    console.warn('ORB detectAndCompute failed:', e)
    src.delete(); gray.delete(); mask.delete(); kpVec.delete(); desc.delete()
    try { orb.delete() } catch {}
    return { keypoints: [], descriptors: [], imageId, scale }
  }

  // Extract keypoints - convert back to original scale
  const keypoints: KeyPoint[] = []
  for (let i = 0; i < kpVec.size(); i++) {
    const kp = kpVec.get(i)
    keypoints.push({
      x: kp.pt.x / scale,
      y: kp.pt.y / scale,
      size: kp.size,
      angle: kp.angle,
      response: kp.response,
      octave: kp.octave,
    })
  }

  // Extract descriptors as 2D uint8 array
  const descriptors: number[][] = []
  for (let i = 0; i < desc.rows; i++) {
    const row: number[] = []
    for (let j = 0; j < desc.cols; j++) {
      row.push(desc.ucharAt(i, j))
    }
    descriptors.push(row)
  }

  src.delete()
  gray.delete()
  mask.delete()
  kpVec.delete()
  desc.delete()
  try { orb.delete() } catch {}

  return { keypoints, descriptors, imageId, scale }
}
