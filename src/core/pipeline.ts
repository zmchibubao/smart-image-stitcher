/**
 * Main processing pipeline coordinator.
 * Runs feature extraction, matching, ordering, border detection, and stitching.
 */
import { loadOpenCV } from '../utils/opencvLoader'
import { extractORBFeatures } from './featureExtractor'
import { matchImages } from './imageMatcher'
import { solveOrder, detectDuplicates } from './orderSolver'
import { removeBlackBorders } from './blackBorderRemover'
import { stitchGroup } from './stitcher'
import type { ImageItem, MatchResult, AppSettings } from '../types'

export interface PipelineCallbacks {
  onProgress: (step: string, progress: number, message: string) => void
  onError: (err: Error) => void
  isCancelled: () => boolean
}

export async function runPipeline(
  images: ImageItem[],
  settings: AppSettings,
  callbacks: PipelineCallbacks,
  exportBg: string
) {
  const { onProgress, onError, isCancelled } = callbacks

  if (images.length === 0) return

  try {
    // --- Step 1: Load OpenCV ---
    onProgress('loading-cv', 0, '正在加载 OpenCV.js...')
    await loadOpenCV()
    if (isCancelled()) return
    onProgress('loading-cv', 100, 'OpenCV.js 加载完成')

    // --- Step 2: Detect black borders ---
    if (settings.removeBlackBorders) {
      onProgress('detecting-borders', 0, '正在检测黑边...')
      for (let i = 0; i < images.length; i++) {
        if (isCancelled()) return
        const img = images[i]
        if (!img.originalBitmap) continue

        try {
          const { borders } = await removeBlackBorders(img.originalBitmap)
          img.blackBorderTop = borders.top
          img.blackBorderBottom = borders.bottom
          img.blackBorderLeft = borders.left
          img.blackBorderRight = borders.right
        } catch (e) {
          console.warn('Border detection failed for', img.name, e)
        }

        onProgress('detecting-borders', Math.round(((i + 1) / images.length) * 100),
          `检测黑边 ${i + 1}/${images.length}`)
      }
    }

    // --- Step 3: Extract ORB features ---
    onProgress('extracting-features', 0, '正在提取图像特征...')
    for (let i = 0; i < images.length; i++) {
      if (isCancelled()) return
      const img = images[i]
      if (!img.originalBitmap) continue
      if (img.features) {
        // Already cached
        onProgress('extracting-features', Math.round(((i + 1) / images.length) * 100),
          `特征提取 ${i + 1}/${images.length} (已缓存)`)
        continue
      }

      try {
        const features = await extractORBFeatures(img.originalBitmap, img.id)
        img.features = features
      } catch (e) {
        console.warn('Feature extraction failed for', img.name, e)
      }

      onProgress('extracting-features', Math.round(((i + 1) / images.length) * 100),
        `特征提取 ${i + 1}/${images.length}: ${img.name}`)

      // Yield to avoid blocking main thread
      await yieldToMain()
    }

    // --- Step 4: Pairwise matching ---
    onProgress('matching', 0, '正在分析图片关系...')
    
    // For efficiency, only match images that could plausibly be adjacent
    // We try all pairs but skip if both have no features
    const matchResults: MatchResult[] = []
    const pairs: [number, number][] = []
    
    for (let i = 0; i < images.length; i++) {
      for (let j = 0; j < images.length; j++) {
        if (i !== j) pairs.push([i, j])
      }
    }

    let pairsDone = 0
    for (const [i, j] of pairs) {
      if (isCancelled()) return

      const imgA = images[i]
      const imgB = images[j]

      if (!imgA.features || !imgB.features) {
        pairsDone++
        continue
      }

      // Skip if already computed (symmetric)
      const existing = matchResults.find(
        m => (m.imageIdA === imgA.id && m.imageIdB === imgB.id) ||
             (m.imageIdA === imgB.id && m.imageIdB === imgA.id)
      )
      if (existing) {
        pairsDone++
        continue
      }

      try {
        const result = await matchImages(
          imgA.id, imgA.features, imgA.height,
          imgB.id, imgB.features, imgB.height
        )
        if (result.confidence !== 'none') {
          matchResults.push(result)
        }
      } catch (e) {
        console.warn('Match failed:', imgA.name, imgB.name, e)
      }

      pairsDone++
      if (pairsDone % 5 === 0) {
        onProgress('matching', Math.round((pairsDone / pairs.length) * 100),
          `分析图片关系 ${pairsDone}/${pairs.length}`)
        await yieldToMain()
      }
    }

    // --- Step 5: Solve order ---
    onProgress('ordering', 0, '正在推断图片顺序...')
    const groups = solveOrder(images, matchResults)
    
    // Detect duplicates
    const duplicates = detectDuplicates(images, matchResults)
    for (const id of duplicates) {
      const img = images.find(i => i.id === id)
      if (img) img.isDuplicate = true
    }

    onProgress('ordering', 100, `识别到 ${groups.length} 个图片组`)
    if (isCancelled()) return

    // --- Step 6: Stitch ---
    onProgress('stitching', 0, '正在拼接图片...')
    const stitchedCanvases = new Map<number, OffscreenCanvas>()

    for (let gi = 0; gi < groups.length; gi++) {
      if (isCancelled()) return
      const group = groups[gi]

      try {
        const result = await stitchGroup(
          group,
          images,
          matchResults,
          {
            removeBlackBorders: settings.removeBlackBorders,
            removeDuplicates: settings.removeDuplicates,
            backgroundColor: exportBg,
          }
        )
        stitchedCanvases.set(group.id, result.canvas)
      } catch (e) {
        console.error('Stitch failed for group', group.id, e)
      }

      onProgress('stitching', Math.round(((gi + 1) / groups.length) * 100),
        `拼接第 ${gi + 1}/${groups.length} 组`)
    }

    return { groups, matchResults, stitchedCanvases }

  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
    return null
  }
}

function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
