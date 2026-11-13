/**
 * 原生 HTML5 Canvas 计算机视觉备用引擎
 * 针对文档、学习笔记与长截图的自适应重叠检测与阅读顺序求解
 */

import type { MatchResult } from '../types'

export interface CanvasImageFeature {
  imageId: string
  width: number
  height: number
  cropTop: number
  cropBottom: number
  cropLeft: number
  cropRight: number
  validW: number
  validH: number
  scale: number
  sW: number
  sH: number
  gray: Uint8Array
  isFg: Uint8Array // 二值化前景笔画图 (1: 文字/笔迹/标注, 0: 背景)
}

const SAMPLE_WIDTH = 240

export async function extractCanvasFeatures(
  bitmap: ImageBitmap,
  imageId: string,
  cropTop = 0,
  cropBottom = 0,
  cropLeft = 0,
  cropRight = 0
): Promise<CanvasImageFeature> {
  const validW = Math.max(10, bitmap.width - cropLeft - cropRight)
  const validH = Math.max(10, bitmap.height - cropTop - cropBottom)

  const scale = Math.min(1, SAMPLE_WIDTH / validW)
  const sW = Math.max(10, Math.round(validW * scale))
  const sH = Math.max(10, Math.round(validH * scale))

  const osc = new OffscreenCanvas(sW, sH)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, cropLeft, cropTop, validW, validH, 0, 0, sW, sH)
  const imgData = ctx.getImageData(0, 0, sW, sH)
  const data = imgData.data

  const totalPixels = sW * sH
  const gray = new Uint8Array(totalPixels)
  const isFg = new Uint8Array(totalPixels)

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4
    const g = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000
    gray[i] = g
    // 灰度低于 235 视为笔迹、文字或彩色标注高亮
    isFg[i] = g < 235 ? 1 : 0
  }

  return {
    imageId,
    width: bitmap.width,
    height: bitmap.height,
    cropTop,
    cropBottom,
    cropLeft,
    cropRight,
    validW,
    validH,
    scale,
    sW,
    sH,
    gray,
    isFg,
  }
}

/**
 * 前景笔画 Dice 相似度匹配 (带水平偏移容差探测)
 */
function compareOverlap2D(
  upper: CanvasImageFeature,
  lower: CanvasImageFeature
): { score: number; overlapH: number; bestDx: number } {
  const sW = upper.sW
  const sH1 = upper.sH
  const sH2 = lower.sH

  const minSearch = Math.floor(Math.min(sH1, sH2) * 0.10)
  const maxSearch = Math.floor(Math.min(sH1, sH2) * 0.88)

  let bestScore = 0
  let bestOverlapRows = 0
  let bestDx = 0

  // 搜索水平微调范围 [-4, 4] 像素
  const dxRange = [-3, 0, 3]

  for (let overlap = minSearch; overlap <= maxSearch; overlap += 2) {
    const start1 = (sH1 - overlap) * sW
    const start2 = 0

    for (let dxi = 0; dxi < dxRange.length; dxi++) {
      const dx = dxRange[dxi]
      let intersectCount = 0
      let totalFg1 = 0
      let totalFg2 = 0

      for (let y = 0; y < overlap; y += 2) {
        const row1 = start1 + y * sW
        const row2 = start2 + y * sW

        for (let x = 4; x < sW - 4; x += 2) {
          const fg1 = upper.isFg[row1 + x]
          const fg2 = lower.isFg[row2 + x + dx]

          if (fg1) totalFg1++
          if (fg2) totalFg2++

          if (fg1 && fg2) {
            intersectCount++
          }
        }
      }

      if (totalFg1 + totalFg2 > 120) {
        const dice = (2 * intersectCount) / (totalFg1 + totalFg2)
        if (dice > bestScore) {
          bestScore = dice
          bestOverlapRows = overlap
          bestDx = dx
        }
      }
    }
  }

  const avgScale = (upper.scale + lower.scale) / 2
  const realOverlapH = Math.round(bestOverlapRows / avgScale)
  const realDx = Math.round(bestDx / avgScale)

  return { score: bestScore, overlapH: realOverlapH, bestDx: realDx }
}

export async function matchImagesCanvas(
  featA: CanvasImageFeature,
  featB: CanvasImageFeature
): Promise<MatchResult> {
  const noMatch: MatchResult = {
    imageIdA: featA.imageId,
    imageIdB: featB.imageId,
    score: 0,
    offsetX: 0,
    offsetY: 0,
    overlapHeightA: 0,
    overlapHeightB: 0,
    confidence: 'none',
    direction: 'unknown',
    inlierCount: 0,
  }

  const resAFirst = compareOverlap2D(featA, featB)
  const resBFirst = compareOverlap2D(featB, featA)

  let bestRes = resAFirst
  let direction: MatchResult['direction'] = 'A_before_B'

  if (resBFirst.score > resAFirst.score) {
    bestRes = resBFirst
    direction = 'B_before_A'
  }

  // 针对笔画重合率：Dice >= 0.28 即可判定有效重叠
  if (bestRes.score < 0.28 || bestRes.overlapH < 25) {
    return noMatch
  }

  let confidence: MatchResult['confidence'] = 'low'
  if (bestRes.score >= 0.50) confidence = 'high'
  else if (bestRes.score >= 0.35) confidence = 'medium'

  const effectiveOffsetY = direction === 'A_before_B'
    ? featA.validH - bestRes.overlapH
    : -(featB.validH - bestRes.overlapH)

  return {
    imageIdA: featA.imageId,
    imageIdB: featB.imageId,
    score: Math.min(1, Math.max(0, bestRes.score)),
    offsetX: direction === 'A_before_B' ? bestRes.bestDx : -bestRes.bestDx,
    offsetY: effectiveOffsetY,
    overlapHeightA: bestRes.overlapH,
    overlapHeightB: bestRes.overlapH,
    confidence,
    direction,
    inlierCount: Math.round(bestRes.score * 50),
  }
}
