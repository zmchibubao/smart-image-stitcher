/**
 * 针对文档、连续笔记与网页长截图的计算机视觉核心匹配引擎
 * 采用多尺度有效墨迹二维零均值归一化互相关 (Active Ink 2D ZNCC) 与文字谷底接缝算法 (Seam Cut)
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
  ink: Float32Array
  hProj: Float32Array
}

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

  const osc = new OffscreenCanvas(validW, validH)
  const ctx = osc.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, cropLeft, cropTop, validW, validH, 0, 0, validW, validH)
  const imgData = ctx.getImageData(0, 0, validW, validH)
  const data = imgData.data

  const ink = new Float32Array(validW * validH)
  const rawHProj = new Float32Array(validH)

  for (let y = 0; y < validH; y++) {
    let rowInk = 0
    const rowOffset = y * validW
    for (let x = 0; x < validW; x++) {
      const idx = (rowOffset + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const avg = (r + g + b) / 3

      // 提取印刷字、手写笔迹及高亮荧光批注
      let val = 0
      if (avg < 205) {
        val = 255 - avg
      } else if (maxC - minC > 20) {
        val = (maxC - minC) * 1.5
      }

      ink[rowOffset + x] = val
      if (x >= 60 && x < validW - 60) {
        rowInk += val
      }
    }
    rawHProj[y] = rowInk / Math.max(1, validW - 120)
  }

  // 1D 平滑以计算文字行与空白谷底
  const hProj = new Float32Array(validH)
  for (let y = 0; y < validH; y++) {
    let sum = 0, wSum = 0
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy
      if (yy >= 0 && yy < validH) {
        sum += rawHProj[yy]
        wSum++
      }
    }
    hProj[y] = sum / wSum
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
    ink,
    hProj,
  }
}

/**
 * 计算上下两张截图在特定重叠高度与水平偏移下的有效墨迹二维互相关系数
 */
function computeActiveInkZNCC(
  upper: CanvasImageFeature,
  lower: CanvasImageFeature,
  overlapH: number,
  dx: number,
  stepY = 2,
  stepX = 4
): number {
  const W = upper.validW
  const H = upper.validH

  let s1 = 0, s2 = 0, count = 0
  for (let y = 0; y < overlapH; y += stepY) {
    const yu = H - overlapH + y
    const yl = y
    // 仅在至少有一张包含有效墨迹的行上计算，彻底避免白底像素自相关产生虚高
    if (upper.hProj[yu] < 6 && lower.hProj[yl] < 6) continue

    const r1 = yu * W
    const r2 = yl * W
    for (let x = 80; x < W - 80; x += stepX) {
      s1 += upper.ink[r1 + x]
      s2 += lower.ink[r2 + x + dx]
      count++
    }
  }

  if (count < 40) return 0
  const m1 = s1 / count
  const m2 = s2 / count

  let cov = 0, v1 = 0, v2 = 0
  for (let y = 0; y < overlapH; y += stepY) {
    const yu = H - overlapH + y
    const yl = y
    if (upper.hProj[yu] < 6 && lower.hProj[yl] < 6) continue

    const r1 = yu * W
    const r2 = yl * W
    for (let x = 80; x < W - 80; x += stepX) {
      const d1 = upper.ink[r1 + x] - m1
      const d2 = lower.ink[r2 + x + dx] - m2
      cov += d1 * d2
      v1 += d1 * d1
      v2 += d2 * d2
    }
  }

  return (v1 > 100 && v2 > 100) ? cov / (Math.sqrt(v1) * Math.sqrt(v2)) : 0
}

/**
 * 上下两张文档/截图之间的定向重叠比对 (全重叠带自适应二维多尺度搜索)
 */
function compareOverlapDocument(
  upper: CanvasImageFeature,
  lower: CanvasImageFeature
): {
  score: number
  overlapH: number
  bestDx: number
  dy: number
  seamCut: number
  contentDiff: number
  supportScore: number
} {
  const H = upper.validH
  // 文档截图中，单行英文基准行高约 75~95px。小于 75px 的重叠不足以覆盖完整单行，容易产生偶然假相关
  const minOverlap = 75
  const maxOverlap = H - 25

  let bestScore = -1
  let bestZ = -1
  let bestOv = 0
  let bestDx = 0

  // 1. 粗粒度快速搜索重叠高度 (步长 2px，水平偏移采样 -10, 0, 10)
  for (let ov = minOverlap; ov <= maxOverlap; ov += 2) {
    for (const cDx of [-10, 0, 10]) {
      const z = computeActiveInkZNCC(upper, lower, ov, cDx, 3, 6)
      if (z > 0.15) {
        // 支持度加权：多行大重叠 (如 300px 覆盖 3 行) 拥有比单行偶然重叠高得多的信息熵与可信度
        const support = z * Math.sqrt(Math.min(ov, 360) / 100)
        if (support > bestScore) {
          bestScore = support
          bestZ = z
          bestOv = ov
          bestDx = cDx
        }
      }
    }
  }

  // 2. 候选峰值精细化微调 (步长 1px，水平偏移微调)
  if (bestScore >= 0.22 && bestOv >= minOverlap) {
    let refinedScore = bestScore
    let refinedZ = bestZ
    let refinedOv = bestOv
    let refinedDx = bestDx

    const searchStart = Math.max(minOverlap, bestOv - 6)
    const searchEnd = Math.min(maxOverlap, bestOv + 6)

    for (let ov = searchStart; ov <= searchEnd; ov++) {
      for (let dx = Math.max(-16, bestDx - 4); dx <= Math.min(16, bestDx + 4); dx += 2) {
        const z = computeActiveInkZNCC(upper, lower, ov, dx, 2, 4)
        if (z > 0.18) {
          const support = z * Math.sqrt(Math.min(ov, 360) / 100)
          if (support > refinedScore) {
            refinedScore = support
            refinedZ = z
            refinedOv = ov
            refinedDx = dx
          }
        }
      }
    }

    // 严格阈值：真重叠的有效墨迹 2D 相关度必须 >= 0.24
    if (refinedZ >= 0.24 && refinedScore >= 0.24) {
      // 3. 计算重叠区域内的最佳无损接缝位置（位于文字行空白谷底，避开文字横向截断）
      let seamCut = Math.floor(refinedOv / 2)
      let minCombinedInk = Infinity
      const startY = Math.max(5, Math.floor(refinedOv * 0.12))
      const endY = Math.min(refinedOv - 5, Math.floor(refinedOv * 0.88))

      for (let y = startY; y <= endY; y++) {
        const p1 = upper.hProj[H - refinedOv + y]
        const p2 = lower.hProj[y]
        const combined = p1 + p2
        if (combined < minCombinedInk) {
          minCombinedInk = combined
          seamCut = y
        }
      }

      return {
        score: Math.min(1.0, refinedZ),
        overlapH: refinedOv,
        bestDx: refinedDx,
        dy: H - refinedOv,
        seamCut,
        contentDiff: Math.max(0, 1 - refinedZ),
        supportScore: refinedScore,
      }
    }
  }

  return { score: 0, overlapH: 0, bestDx: 0, dy: 0, seamCut: 0, contentDiff: 1, supportScore: 0 }
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
    contentDiff: 1,
    decision: 'rejected',
  }

  const resAFirst = compareOverlapDocument(featA, featB)
  const resBFirst = compareOverlapDocument(featB, featA)

  // 比较两种方向的置信度 (使用支持度加权评分)
  let bestRes = resAFirst
  let direction: MatchResult['direction'] = 'A_before_B'

  if (resBFirst.supportScore > resAFirst.supportScore) {
    bestRes = resBFirst
    direction = 'B_before_A'
  }

  if (bestRes.score < 0.24 || bestRes.overlapH < 75) {
    return noMatch
  }

  let confidence: MatchResult['confidence'] = 'low'
  if (bestRes.score >= 0.50 || bestRes.supportScore >= 0.50) confidence = 'high'
  else if (bestRes.score >= 0.30 || bestRes.supportScore >= 0.32) confidence = 'medium'

  const effectiveOffsetY =
    direction === 'A_before_B'
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
    seamCut: bestRes.seamCut,
    contentDiff: bestRes.contentDiff,
    decision: 'accepted',
  }
}
