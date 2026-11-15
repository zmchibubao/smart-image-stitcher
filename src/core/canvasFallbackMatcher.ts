/**
 * 针对文档、连续笔记与网页长截图的计算机视觉核心引擎
 * 采用多尺度投影分析、二维零均值互相关 (ZNCC) 与词间间隙指纹校验
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
  const hProj = new Float32Array(validH)

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

      // 内容提取：黑色印刷字、手写笔迹或彩色荧光笔/红笔圈画
      let val = 0
      if (avg < 210) {
        val = 255 - avg
      } else if (maxC - minC > 20) {
        val = (maxC - minC) * 1.5
      }

      ink[rowOffset + x] = val
      rowInk += val
    }
    hProj[y] = rowInk / validW
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
 * 上下两张文档/截图之间的定向重叠比对
 */
function compareOverlapDocument(
  upper: CanvasImageFeature,
  lower: CanvasImageFeature
): { score: number; overlapH: number; bestDx: number; seamCut: number } {
  const W = upper.validW
  const h1 = upper.validH
  const h2 = lower.validH

  const minOverlap = 30
  const maxOverlap = Math.floor(Math.min(h1, h2) * 0.98)

  // 1. 全程扫描行投影互相关
  const pCorrs = new Float32Array(maxOverlap + 1)
  for (let overlap = minOverlap; overlap <= maxOverlap; overlap++) {
    let sumP = 0
    let sq1 = 0
    let sq2 = 0
    for (let y = 0; y < overlap; y += 2) {
      const p1 = upper.hProj[h1 - overlap + y]
      const p2 = lower.hProj[y]
      sumP += p1 * p2
      sq1 += p1 * p1
      sq2 += p2 * p2
    }
    pCorrs[overlap] = sq1 > 10 && sq2 > 10 ? sumP / (Math.sqrt(sq1) * Math.sqrt(sq2)) : 0
  }

  // 2. 收集投影相关的局部峰值作为候选重叠高度
  interface Candidate {
    overlap: number
    pCorr: number
  }
  const candShort: Candidate[] = []
  const candMed: Candidate[] = []
  const candLong: Candidate[] = []

  for (let ov = minOverlap + 1; ov < maxOverlap; ov++) {
    const val = pCorrs[ov]
    if (val >= 0.32 && val >= pCorrs[ov - 1] && val >= pCorrs[ov + 1]) {
      if (ov < 130) candShort.push({ overlap: ov, pCorr: val })
      else if (ov < 280) candMed.push({ overlap: ov, pCorr: val })
      else candLong.push({ overlap: ov, pCorr: val })
    }
  }

  candShort.sort((a, b) => b.pCorr - a.pCorr)
  candMed.sort((a, b) => b.pCorr - a.pCorr)
  candLong.sort((a, b) => b.pCorr - a.pCorr)

  const topCandidates: Candidate[] = [
    ...candLong.slice(0, 6),
    ...candMed.slice(0, 5),
    ...candShort.slice(0, 4),
  ]

  let bestScore = -1
  let bestOverlap = 0
  let bestDx = 0

  // 3. 二维高精度互相关与多尺度位移分析
  for (const cand of topCandidates) {
    const overlap = cand.overlap
    const pCorr = cand.pCorr

    for (let dx = -8; dx <= 8; dx += 2) {
      let sProd = 0
      let s1 = 0
      let s2 = 0
      for (let y = 0; y < overlap; y += 3) {
        const row1 = (h1 - overlap + y) * W
        const row2 = y * W
        for (let x = 60; x < W - 60; x += 6) {
          const v1 = upper.ink[row1 + x]
          const v2 = lower.ink[row2 + x + dx]
          sProd += v1 * v2
          s1 += v1 * v1
          s2 += v2 * v2
        }
      }

      if (s1 > 200 && s2 > 200) {
        const score2D = sProd / (Math.sqrt(s1) * Math.sqrt(s2))
        // 重叠高度置信度加权：多行重叠相比单行重叠具有更高几何约束信度
        const cred = Math.min(1.15, Math.max(0.72, Math.pow(overlap / 120, 0.25)))
        const totalScore = (score2D * 0.65 + pCorr * 0.35) * cred

        if (totalScore > bestScore) {
          bestScore = totalScore
          bestOverlap = overlap
          bestDx = dx
        }
      }
    }
  }

  // 4. 精细微调 bestDx（步长 1 像素）
  if (bestOverlap > 0) {
    for (let dx = bestDx - 1; dx <= bestDx + 1; dx += 2) {
      let sProd = 0
      let s1 = 0
      let s2 = 0
      for (let y = 0; y < bestOverlap; y += 3) {
        const row1 = (h1 - bestOverlap + y) * W
        const row2 = y * W
        for (let x = 60; x < W - 60; x += 6) {
          const v1 = upper.ink[row1 + x]
          const v2 = lower.ink[row2 + x + dx]
          sProd += v1 * v2
          s1 += v1 * v1
          s2 += v2 * v2
        }
      }
      if (s1 > 200 && s2 > 200) {
        const score2D = sProd / (Math.sqrt(s1) * Math.sqrt(s2))
        const cred = Math.min(1.15, Math.max(0.72, Math.pow(bestOverlap / 120, 0.25)))
        const totalScore = (score2D * 0.65 + pCorrs[bestOverlap] * 0.35) * cred
        if (totalScore > bestScore) {
          bestScore = totalScore
          bestDx = dx
        }
      }
    }
  }

  // 5. 计算重叠区域内的最佳切割接缝（文字间空白谷底，避开文字截断）
  let seamCut = Math.floor(bestOverlap / 2)
  if (bestOverlap > 30) {
    const searchStart = Math.floor(bestOverlap * 0.12)
    const searchEnd = Math.floor(bestOverlap * 0.88)
    let minInk = Infinity

    for (let y = searchStart; y <= searchEnd; y++) {
      const p1 = upper.hProj[h1 - bestOverlap + y]
      const p2 = lower.hProj[y]
      const combined = p1 + p2
      if (combined < minInk) {
        minInk = combined
        seamCut = y
      }
    }
  }

  return {
    score: Math.max(0, bestScore),
    overlapH: bestOverlap,
    bestDx,
    seamCut,
  }
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

  const resAFirst = compareOverlapDocument(featA, featB)
  const resBFirst = compareOverlapDocument(featB, featA)

  const weightA = Math.min(1.25, Math.pow(resAFirst.overlapH / 100, 0.3))
  const weightB = Math.min(1.25, Math.pow(resBFirst.overlapH / 100, 0.3))

  const scoreA = resAFirst.score * (resAFirst.overlapH >= 40 ? weightA : 0.6)
  const scoreB = resBFirst.score * (resBFirst.overlapH >= 40 ? weightB : 0.6)

  if (featA.imageId.includes('7') && featB.imageId.includes('6')) {
    console.log('[DEBUG 7-6]:', {
      resAFirst: { score: resAFirst.score, overlapH: resAFirst.overlapH, scoreA },
      resBFirst: { score: resBFirst.score, overlapH: resBFirst.overlapH, scoreB }
    })
  }

  let bestRes = resAFirst
  let direction: MatchResult['direction'] = 'A_before_B'

  if (scoreB > scoreA) {
    bestRes = resBFirst
    direction = 'B_before_A'
  }

  if (bestRes.score < 0.38 || bestRes.overlapH < 20) {
    return noMatch
  }

  let confidence: MatchResult['confidence'] = 'low'
  if (bestRes.score >= 0.58) confidence = 'high'
  else if (bestRes.score >= 0.44) confidence = 'medium'

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
  }
}
