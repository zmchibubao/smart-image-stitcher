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

// 调度让出主线程，确保浏览器保持流畅渲染与响应
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
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
    // --- Step 1: 异步加载 OpenCV 并给与明确进度通知 ---
    onProgress('loading-cv', 10, '正在加载计算机视觉引擎 (OpenCV.js)...')
    await yieldToMain()
    await loadOpenCV()
    if (isCancelled()) return
    onProgress('loading-cv', 100, '计算机视觉引擎已就绪')
    await yieldToMain()

    // --- Step 2: 检测与去除黑边 ---
    if (settings.removeBlackBorders) {
      onProgress('detecting-borders', 0, '正在检测黑边与无效区域...')
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

        onProgress(
          'detecting-borders',
          Math.round(((i + 1) / images.length) * 100),
          `检测黑边 ${i + 1}/${images.length}`
        )
        await yieldToMain()
      }
    }

    // --- Step 3: 提取 ORB 特征 ---
    onProgress('extracting-features', 0, '正在分析图片特征...')
    for (let i = 0; i < images.length; i++) {
      if (isCancelled()) return
      const img = images[i]
      if (!img.originalBitmap) continue

      if (!img.features) {
        try {
          const features = await extractORBFeatures(img.originalBitmap, img.id)
          img.features = features
        } catch (e) {
          console.warn('Feature extraction failed for', img.name, e)
        }
      }

      onProgress(
        'extracting-features',
        Math.round(((i + 1) / images.length) * 100),
        `提取特征 ${i + 1}/${images.length}: ${img.name}`
      )
      // 每张提取完都释放一次主线程，UI 进度条平滑刷新
      await yieldToMain()
    }

    // --- Step 4: 两两匹配与几何估计 ---
    onProgress('matching', 0, '正在智能比对图片重叠区域...')
    const matchResults: MatchResult[] = []
    const pairs: [number, number][] = []

    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        pairs.push([i, j])
      }
    }

    const totalPairs = Math.max(1, pairs.length)
    for (let p = 0; p < pairs.length; p++) {
      if (isCancelled()) return
      const [i, j] = pairs[p]
      const imgA = images[i]
      const imgB = images[j]

      if (imgA.features && imgB.features) {
        try {
          const result = await matchImages(
            imgA.id,
            imgA.features,
            imgA.height,
            imgB.id,
            imgB.features,
            imgB.height
          )
          if (result.confidence !== 'none') {
            matchResults.push(result)
          }
        } catch (e) {
          console.warn('Match failed:', imgA.name, imgB.name, e)
        }
      }

      onProgress(
        'matching',
        Math.round(((p + 1) / totalPairs) * 100),
        `比对进度 ${p + 1}/${totalPairs}`
      )
      // 每次两两比对后都让出主线程，完全杜绝浏览器页面无响应
      await yieldToMain()
    }

    // --- Step 5: 全局推断顺序与独立组识别 ---
    onProgress('ordering', 50, '正在推断全局阅读顺序...')
    await yieldToMain()
    const groups = solveOrder(images, matchResults)

    // 重复图片检测
    const duplicates = detectDuplicates(images, matchResults)
    for (const id of duplicates) {
      const img = images.find(item => item.id === id)
      if (img) img.isDuplicate = true
    }

    onProgress('ordering', 100, `识别到 ${groups.length} 个独立拼接组`)
    await yieldToMain()
    if (isCancelled()) return

    // --- Step 6: 执行最终无缝长图拼接 ---
    onProgress('stitching', 0, '正在生成无缝长图...')
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

      onProgress(
        'stitching',
        Math.round(((gi + 1) / groups.length) * 100),
        `拼接完成第 ${gi + 1}/${groups.length} 组`
      )
      await yieldToMain()
    }

    return { groups, matchResults, stitchedCanvases }
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
    return null
  }
}
