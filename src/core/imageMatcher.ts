import type { ORBFeatures, KeyPoint, MatchResult } from '../types'

interface DMatch {
  queryIdx: number
  trainIdx: number
  distance: number
}

// Hamming distance for binary ORB descriptors
function hammingDistance(a: number[], b: number[]): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    let xor = (a[i] ^ b[i]) >>> 0
    // Popcount
    xor = xor - ((xor >> 1) & 0x55555555)
    xor = (xor & 0x33333333) + ((xor >> 2) & 0x33333333)
    xor = (xor + (xor >> 4)) & 0x0f0f0f0f
    dist += (xor * 0x01010101) >>> 24
  }
  return dist
}

// Brute-force nearest neighbor with Lowe's ratio test
function matchDescriptors(descA: number[][], descB: number[][]): DMatch[] {
  const matches: DMatch[] = []

  for (let i = 0; i < descA.length; i++) {
    let best1 = Infinity, best2 = Infinity
    let bestJ = -1

    for (let j = 0; j < descB.length; j++) {
      const d = hammingDistance(descA[i], descB[j])
      if (d < best1) {
        best2 = best1
        best1 = d
        bestJ = j
      } else if (d < best2) {
        best2 = d
      }
    }

    // Lowe's ratio test: 0.75 is standard for ORB
    if (bestJ >= 0 && best1 < best2 * 0.75) {
      matches.push({ queryIdx: i, trainIdx: bestJ, distance: best1 })
    }
  }

  return matches
}

// RANSAC with translation model (best for document screenshots)
function estimateTranslationRANSAC(
  kpsA: KeyPoint[],
  kpsB: KeyPoint[],
  matches: DMatch[],
  maxIter = 500,
  threshold = 8
): { tx: number; ty: number; inliers: DMatch[]; scale: number } | null {
  if (matches.length < 4) return null

  let bestInliers: DMatch[] = []

  for (let iter = 0; iter < maxIter; iter++) {
    const m = matches[Math.floor(Math.random() * matches.length)]
    const ptA = kpsA[m.queryIdx]
    const ptB = kpsB[m.trainIdx]
    const tx = ptA.x - ptB.x
    const ty = ptA.y - ptB.y

    const inliers: DMatch[] = []
    for (const match of matches) {
      const pA = kpsA[match.queryIdx]
      const pB = kpsB[match.trainIdx]
      const dx = (pA.x - pB.x) - tx
      const dy = (pA.y - pB.y) - ty
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        inliers.push(match)
      }
    }

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers
    }
  }

  if (bestInliers.length < 4) return null

  // Refine with inliers (least squares)
  let sumTx = 0, sumTy = 0
  for (const m of bestInliers) {
    sumTx += kpsA[m.queryIdx].x - kpsB[m.trainIdx].x
    sumTy += kpsA[m.queryIdx].y - kpsB[m.trainIdx].y
  }

  const tx = sumTx / bestInliers.length
  const ty = sumTy / bestInliers.length

  return { tx, ty, inliers: bestInliers, scale: 1.0 }
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
    featuresA.keypoints.length < 8 ||
    featuresB.keypoints.length < 8
  ) {
    return noMatch
  }

  const rawMatches = matchDescriptors(featuresA.descriptors, featuresB.descriptors)

  if (rawMatches.length < 4) return noMatch

  const result = estimateTranslationRANSAC(featuresA.keypoints, featuresB.keypoints, rawMatches)

  if (!result) return noMatch

  const { tx, ty, inliers } = result

  // Score based on inlier count relative to total keypoints
  const score = Math.min(
    1,
    inliers.length / Math.min(50, Math.min(featuresA.keypoints.length, featuresB.keypoints.length))
  )

  let confidence: MatchResult['confidence'] = 'none'
  if (score >= 0.5 && inliers.length >= 15) confidence = 'high'
  else if (score >= 0.25 && inliers.length >= 8) confidence = 'medium'
  else if (score >= 0.1 && inliers.length >= 4) confidence = 'low'

  // Direction: ty = how much B is shifted up relative to A
  // If ty < 0: keypoints of A appear ABOVE corresponding points in B
  // => A content is higher on screen => A comes before B (A is above B)
  // If ty > 0: B content is higher => B comes before A
  let direction: MatchResult['direction'] = 'unknown'
  let overlapHeightA = 0
  let overlapHeightB = 0

  if (Math.abs(ty) > 20) {
    // ty < 0 means A's keypoints have higher Y than B's => B overlaps top portion of A content
    // actually: tx = kpA.x - kpB.x, ty = kpA.y - kpB.y
    // If ty > 0: same point in A is LOWER than in B => A is below B => B first
    // If ty < 0: same point in A is HIGHER than in B => A is above B => A first
    if (ty < 0) {
      direction = 'B_before_A'
      // B appears before A. B's bottom overlaps A's top.
      const bOverlapStart = heightB + ty  // ty is negative
      overlapHeightB = Math.max(0, Math.min(heightB, heightB - bOverlapStart))
      overlapHeightA = Math.max(0, Math.min(heightA, overlapHeightB))
    } else {
      direction = 'A_before_B'
      // A appears before B. A's bottom overlaps B's top.
      const aUniqueHeight = ty // how many pixels of A are unique before the overlap
      overlapHeightA = Math.max(0, Math.min(heightA, heightA - aUniqueHeight))
      overlapHeightB = Math.max(0, Math.min(heightB, overlapHeightA))
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
