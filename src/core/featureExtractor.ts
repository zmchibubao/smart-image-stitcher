import { loadOpenCV } from '../utils/opencvLoader'
import type { ORBFeatures, KeyPoint } from '../types'

const MAX_FEATURE_SIZE = 600 // 缩放上限设置为 600px，既能保证极高的关键点精度，又能数十倍加快速度

export async function extractORBFeatures(
  bitmap: ImageBitmap,
  imageId: string,
  maxKeypoints = 300
): Promise<ORBFeatures> {
  const cv = await loadOpenCV()

  const scale = Math.min(1, MAX_FEATURE_SIZE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const osc = new OffscreenCanvas(w, h)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)

  let src: any = null
  let gray: any = null
  let mask: any = null
  let kpVec: any = null
  let desc: any = null
  let orb: any = null

  try {
    src = cv.matFromImageData(imageData)
    gray = new cv.Mat()
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    try {
      orb = new cv.ORB(maxKeypoints, 1.2, 4, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 20)
    } catch {
      try {
        orb = cv.ORB.create(maxKeypoints)
      } catch {
        return { keypoints: [], descriptors: [], imageId, scale }
      }
    }

    mask = new cv.Mat()
    kpVec = new cv.KeyPointVector()
    desc = new cv.Mat()

    orb.detectAndCompute(gray, mask, kpVec, desc)

    const keypoints: KeyPoint[] = []
    const kpCount = kpVec.size()
    for (let i = 0; i < kpCount; i++) {
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

    const descriptors: number[][] = []
    for (let i = 0; i < desc.rows; i++) {
      const row: number[] = []
      for (let j = 0; j < desc.cols; j++) {
        row.push(desc.ucharAt(i, j))
      }
      descriptors.push(row)
    }

    return { keypoints, descriptors, imageId, scale }
  } catch (e) {
    console.warn('ORB extract failed:', e)
    return { keypoints: [], descriptors: [], imageId, scale }
  } finally {
    try { src?.delete() } catch {}
    try { gray?.delete() } catch {}
    try { mask?.delete() } catch {}
    try { kpVec?.delete() } catch {}
    try { desc?.delete() } catch {}
    try { orb?.delete() } catch {}
  }
}
