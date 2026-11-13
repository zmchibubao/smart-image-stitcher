import type { ORBFeatures, KeyPoint, MatchResult } from '../types'

interface DMatch {
  queryIdx: number
  trainIdx: number
  distance: number
}

// 快速汉明距离（利用 Lookup Table 快速统计不同位）
const POPCNT_LUT = new Uint8Array(256)
for (let i = 0; i < 256; i++) {
  let count = 0
  let v = i
  while (v > 0) {
    count += v & 1
    v >>= 1
  }
  POPCNT_LUT[i] = count
}

function hammingDistance(a: number[], b: number[]): number {
  let dist = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dist += POPCNT_LUT[a[i] ^ b[i]]
  }
  return dist
}

// 快速描述子匹配 (最多比对最强的 300 个特征点，耗时仅数毫秒)
function matchDescriptors(descA: number[][], descB: number[][]): DMatch[] {
  const matches: DMatch[] = []
  const maxA = Math.min(descA.length, 300)
  const maxB = Math.min(descB.length, 300)

  for (let i = 0; i < maxA; i++) {
    let best1 = Infinity
    let best2 = Infinity
    let bestJ = -1

    const da = descA[i]
    for (let j = 0; j < maxB; j++) {
      const d = hammingDistance(da, descB[j])
      if (d < best1) {
        best2 = best1
        best1 = d
        bestJ = j
      } else if (d < best2) {
        best2 = d
      }
    }

    // Lowe's ratio test: 0.75
    if (bestJ >= 0 && best1 < best2 * 0.75) {
      matches.push({ queryIdx: i, trainIdx: bestJ, distance: best1 })
    }
  }

  return matches
}

// RANSAC 估计平移位移 (tx, ty)
function estimateTranslationRANSAC(
  kpsA: KeyPoint[],
  kpsB: KeyPoint[],
  matches: DMatch[],
  maxIter = 150,
  threshold = 12
): { tx: number; ty: number; inliers: DMatch[] } | null {
  if (matches.length < 4) return null

  let bestInliers: DMatch[] = []

  for (let iter = 0; iter < maxIter; iter++) {
    const m = matches[Math.floor(Math.random() * matches.length)]
    const ptA = kpsA[m.queryIdx]
    const ptB = kpsB[m.trainIdx]
    const tx = ptA.x - ptB.x
    const ty = ptA.y - ptB.y

    const inliers: DMatch[] = []
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const pA = kpsA[match.queryIdx]
      const pB = kpsB[match.trainIdx]
      const dx = (pA.x - pB.x) - tx
      const dy = (pA.y - pB.y) - ty
      if (dx * dx + dy * dy < threshold * threshold) {
        inliers.push(match)
      }
    }

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers
    }

    if (bestInliers.length > matches.length * 0.75) {
      break
    }
  }

  if (bestInliers.length < 4) return null

  // 最小二乘精炼
  let sumTx = 0
  let sumTy = 0
  for (let i = 0; i < bestInliers.length; i++) {
    const m = bestInliers[i]
    sumTx += kpsA[m.queryIdx].x - kpsB[m.trainIdx].x
    sumTy += kpsA[m.queryIdx].y - kpsB[m.trainIdx].y
  }

  const tx = sumTx / bestInliers.length
  const ty = sumTy / bestInliers.length

  return { tx, ty, inliers: bestInliers }
}

export async function matchImages(
  idA: string,
  featuresA: ORBFeatures,
  heightA: number,
  idB: string,
  featuresB: ORBFeatures,
  heightB: number
): Promise<MatchResult> {
  const noMatch: MatchResult = {
    imageIdA: idA,
    imageIdB: idB,
    score: 0,
    offsetX: 0,
    offsetY: 0,
    overlapHeightA: 0,
    overlapHeightB: 0,
    confidence: 'none',
    direction: 'unknown',
    inlierCount: 0,
  }

  if (
    !featuresA.descriptors.length ||
    !featuresB.descriptors.length ||
    featuresA.keypoints.length < 5 ||
    featuresB.keypoints.length < 5
  ) {
    return noMatch
  }

  const rawMatches = matchDescriptors(featuresA.descriptors, featuresB.descriptors)
  if (rawMatches.length < 4) return noMatch

  const result = estimateTranslationRANSAC(featuresA.keypoints, featuresB.keypoints, rawMatches)
  if (!result) return noMatch

  const { tx, ty, inliers } = result

  const score = Math.min(
    1,
    inliers.length / Math.min(25, Math.min(featuresA.keypoints.length, featuresB.keypoints.length))
  )

  let confidence: MatchResult['confidence'] = 'none'
  if (score >= 0.40 && inliers.length >= 8) confidence = 'high'
  else if (score >= 0.20 && inliers.length >= 5) confidence = 'medium'
  else if (inliers.length >= 4) confidence = 'low'

  let direction: MatchResult['direction'] = 'unknown'
  let overlapHeightA = 0
  let overlapHeightB = 0

  if (Math.abs(ty) > 15) {
    if (ty < 0) {
      // ty = ptA.y - ptB.y < 0 => ptB.y > ptA.y => B 在上，A 在下
      direction = 'B_before_A'
      // 重叠高度为 B 的底部与 A 的顶部重叠高度: heightB + ty (ty为负数)
      const overlapH = Math.max(0, Math.min(heightA, Math.min(heightB, heightB + ty)))
      overlapHeightB = overlapH
      overlapHeightA = overlapH
    } else {
      // ty = ptA.y - ptB.y > 0 => ptA.y > ptB.y => A 在上，B 在下
      direction = 'A_before_B'
      // 重叠高度为 A 的底部与 B 的顶部重叠高度: heightA - ty
      const overlapH = Math.max(0, Math.min(heightA, Math.min(heightB, heightA - ty)))
      overlapHeightA = overlapH
      overlapHeightB = overlapH
    }
  }

  return {
    imageIdA: idA,
    imageIdB: idB,
    score: confidence === 'none' ? 0 : score,
    offsetX: Math.round(tx),
    offsetY: Math.round(ty),
    overlapHeightA: Math.round(overlapHeightA),
    overlapHeightB: Math.round(overlapHeightB),
    confidence,
    direction,
    inlierCount: inliers.length,
  }
}
