/**
 * 智能流水线调度器 (Smart Pipeline Coordinator)
 * 具备双引擎架构与文档截图专用匹配器：
 * 1. 深度引擎：OpenCV.js (ORB 特征提取 + RANSAC 对齐)
 * 2. 备用与文档引擎：HTML5 Canvas (2D 文本笔画、投影相关、词间间隙指纹与空白谷底无损接缝)
 *
 * 保证零阻塞、百分之百可用、平滑回退、严格遵循用户设定。
 */

import { isCVReady } from '../utils/opencvLoader'
import { extractORBFeatures } from './featureExtractor'
import { matchImages } from './imageMatcher'
import { extractCanvasFeatures, matchImagesCanvas } from './canvasFallbackMatcher'
import { solveOrder, detectDuplicates } from './orderSolver'
import { removeBlackBorders } from './blackBorderRemover'
import { stitchGroup } from './stitcher'
import { assessStitchQuality, type StitchQualityReport } from './qualityAssessor'
import type { ImageItem, MatchResult, AppSettings, StitchGroup } from '../types'

export interface PipelineCallbacks {
  onProgress: (step: string, progress: number, message: string, engine?: 'opencv' | 'canvas') => void
  onError: (err: Error) => void
  isCancelled: () => boolean
}

export interface PipelineResult {
  groups: StitchGroup[]
  matchResults: MatchResult[]
  stitchedCanvases: Map<number, OffscreenCanvas>
  engineUsed: 'opencv' | 'canvas'
  qualityReports: Map<number, StitchQualityReport>
}

function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function runPipeline(
  images: ImageItem[],
  settings: AppSettings,
  callbacks: PipelineCallbacks,
  exportBg: string,
  userLockedOrder?: string[]
): Promise<PipelineResult | null> {
  const { onProgress, onError, isCancelled } = callbacks
  if (images.length === 0) return null

  let engine: 'opencv' | 'canvas' = 'canvas'

  try {
    // --- Step 1: 确定图像计算引擎 ---
    onProgress('loading-cv', 10, '检查视觉引擎状态...')
    await yieldToMain()

    if (isCVReady()) {
      engine = 'opencv'
      onProgress('loading-cv', 100, '计算机视觉引擎 (OpenCV.js) 就绪', 'opencv')
    } else {
      engine = 'canvas'
      onProgress('loading-cv', 100, '已启用原生文档与长截图高精度图像引擎', 'canvas')
    }
    await yieldToMain()
    if (isCancelled()) return null

    // --- Step 2: 黑边与无效区域检测 ---
    if (settings.removeBlackBorders) {
      onProgress('detecting-borders', 0, '正在智能检测黑边与多余边框...', engine)
      for (let i = 0; i < images.length; i++) {
        if (isCancelled()) return null
        const img = images[i]
        if (!img.originalBitmap) continue

        try {
          const { borders } = await removeBlackBorders(img.originalBitmap)
          img.blackBorderTop = borders.top
          img.blackBorderBottom = borders.bottom
          img.blackBorderLeft = borders.left
          img.blackBorderRight = borders.right
        } catch (e) {
          console.warn('Black border removal failed for', img.name, e)
        }

        onProgress(
          'detecting-borders',
          Math.round(((i + 1) / images.length) * 100),
          `黑边检测 ${i + 1}/${images.length}`,
          engine
        )
        await yieldToMain()
      }
    }

    // --- Step 3: 特征提取 ---
    onProgress('extracting-features', 0, '正在分析图片内容特征...', engine)
    for (let i = 0; i < images.length; i++) {
      if (isCancelled()) return null
      const img = images[i]
      if (!img.originalBitmap) continue

      // 文档与笔记特征分析（无论 OpenCV 是否可用，都计算文档投影与笔迹指纹）
      img.canvasFeature = await extractCanvasFeatures(
        img.originalBitmap,
        img.id,
        img.blackBorderTop,
        img.blackBorderBottom,
        img.blackBorderLeft,
        img.blackBorderRight
      )

      if (engine === 'opencv' && !img.features) {
        try {
          img.features = await extractORBFeatures(
            img.originalBitmap,
            img.id,
            img.blackBorderTop,
            img.blackBorderBottom,
            img.blackBorderLeft,
            img.blackBorderRight
          )
        } catch (e) {
          console.warn('ORB 特征提取降级:', e)
        }
      }

      onProgress(
        'extracting-features',
        Math.round(((i + 1) / images.length) * 100),
        `提取特征 ${i + 1}/${images.length}: ${img.name}`,
        engine
      )
      await yieldToMain()
    }

    // --- Step 4: 两两匹配与重叠几何估计 ---
    onProgress('matching', 0, '正在比对重叠区域与阅读顺序...', engine)
    const matchResults: MatchResult[] = []
    const pairs: [number, number][] = []

    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        pairs.push([i, j])
      }
    }

    const totalPairs = Math.max(1, pairs.length)
    for (let p = 0; p < pairs.length; p++) {
      if (isCancelled()) return null
      const [i, j] = pairs[p]
      const imgA = images[i]
      const imgB = images[j]

      try {
        let matchRes: MatchResult | null = null

        if (imgA.canvasFeature && imgB.canvasFeature) {
          matchRes = await matchImagesCanvas(imgA.canvasFeature, imgB.canvasFeature)
        } else if (engine === 'opencv' && imgA.features && imgB.features) {
          const hA = Math.max(10, imgA.height - imgA.blackBorderTop - imgA.blackBorderBottom)
          const hB = Math.max(10, imgB.height - imgB.blackBorderTop - imgB.blackBorderBottom)
          matchRes = await matchImages(imgA.id, imgA.features, hA, imgB.id, imgB.features, hB)
        }

        if (matchRes && matchRes.confidence !== 'none') {
          matchResults.push(matchRes)
        }
      } catch (e) {
        console.warn('Pair matching failed:', imgA.name, imgB.name, e)
      }

      onProgress(
        'matching',
        Math.round(((p + 1) / totalPairs) * 100),
        `比对进度 ${p + 1}/${totalPairs}`,
        engine
      )
      await yieldToMain()
    }

    // --- Step 5: 全局排序求解 ---
    onProgress('ordering', 50, '正在推断全局阅读顺序...', engine)
    await yieldToMain()

    let groups: StitchGroup[] = []

    if (settings.autoSort) {
      const lockedPositions = new Map<string, number>()
      if (userLockedOrder && userLockedOrder.length > 0) {
        for (let idx = 0; idx < userLockedOrder.length; idx++) {
          const id = userLockedOrder[idx]
          const targetImg = images.find(img => img.id === id)
          if (targetImg?.locked) {
            lockedPositions.set(id, idx)
          }
        }
      }

      groups = solveOrder(images, matchResults, lockedPositions.size > 0 ? lockedPositions : undefined)
    } else {
      const manualIds = images.map(i => i.id)
      groups = [{ id: 0, imageIds: manualIds, matches: matchResults }]
    }

    // 重复图片标记
    const duplicates = detectDuplicates(images, matchResults)
    for (const id of duplicates) {
      const img = images.find(item => item.id === id)
      if (img) img.isDuplicate = true
    }

    onProgress('ordering', 100, `推断完成，发现 ${groups.length} 个独立拼接组`, engine)
    await yieldToMain()
    if (isCancelled()) return null

    // --- Step 6: 自动对齐与无缝拼接 ---
    onProgress('stitching', 0, '正在合成高清长图...', engine)
    const stitchedCanvases = new Map<number, OffscreenCanvas>()
    const qualityReports = new Map<number, StitchQualityReport>()

    for (let gi = 0; gi < groups.length; gi++) {
      if (isCancelled()) return null
      const group = groups[gi]

      try {
        const result = await stitchGroup(
          group,
          images,
          matchResults,
          {
            removeBlackBorders: settings.removeBlackBorders,
            removeDuplicates: settings.removeDuplicates,
            autoAlign: settings.autoAlign,
            backgroundColor: exportBg,
          }
        )
        stitchedCanvases.set(group.id, result.canvas)

        // 进行拼接质量评估
        const qualityReport = assessStitchQuality(group, images, matchResults)
        qualityReports.set(group.id, qualityReport)
      } catch (e) {
        console.error('Group stitching error:', group.id, e)
      }

      onProgress(
        'stitching',
        Math.round(((gi + 1) / groups.length) * 100),
        `拼接完成第 ${gi + 1}/${groups.length} 组`,
        engine
      )
      await yieldToMain()
    }

    return { groups, matchResults, stitchedCanvases, engineUsed: engine, qualityReports }
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
    return null
  }
}
