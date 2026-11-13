import type { ImageItem, MatchResult, StitchGroup, ExportOptions } from '../types'

export interface StitchResult {
  groupId: number
  canvas: OffscreenCanvas
  width: number
  height: number
  truncated: boolean
}

const MAX_CANVAS_HEIGHT = 32767 // 现代浏览器 Canvas 安全极限高度

/**
 * 将一组已经排好序的图片合成为一张无缝纵向长图
 */
export async function stitchGroup(
  group: StitchGroup,
  images: ImageItem[],
  allMatches: MatchResult[],
  settings: {
    removeBlackBorders: boolean
    removeDuplicates: boolean
    autoAlign?: boolean
    backgroundColor: string
  }
): Promise<StitchResult> {
  const orderedImages = group.imageIds
    .map(id => images.find(img => img.id === id))
    .filter(Boolean) as ImageItem[]

  if (orderedImages.length === 0) {
    throw new Error('拼接组中没有有效图片')
  }

  // 建立相邻匹配快速索引
  const matchLookup = new Map<string, MatchResult>()
  for (const m of allMatches) {
    matchLookup.set(`${m.imageIdA}→${m.imageIdB}`, m)
    matchLookup.set(`${m.imageIdB}→${m.imageIdA}`, {
      ...m,
      imageIdA: m.imageIdB,
      imageIdB: m.imageIdA,
      offsetX: -m.offsetX,
      offsetY: -m.offsetY,
      overlapHeightA: m.overlapHeightB,
      overlapHeightB: m.overlapHeightA,
    })
  }

  interface Placement {
    image: ImageItem
    destX: number
    destY: number
    srcX: number
    srcY: number
    srcW: number
    srcH: number
  }

  const placements: Placement[] = []
  let currentY = 0
  let cumulativeOffsetX = 0
  let minGlobalX = 0
  let maxGlobalX = 0

  for (let i = 0; i < orderedImages.length; i++) {
    const img = orderedImages[i]
    if (!img.originalBitmap) continue

    const imgH = img.originalBitmap.height
    const imgW = img.originalBitmap.width

    let cropTop = settings.removeBlackBorders ? (img.blackBorderTop || 0) : 0
    let cropBottom = settings.removeBlackBorders ? (img.blackBorderBottom || 0) : 0
    let cropLeft = settings.removeBlackBorders ? (img.blackBorderLeft || 0) : 0
    let cropRight = settings.removeBlackBorders ? (img.blackBorderRight || 0) : 0

    // 如果不是第一张图，检测并裁切与上一张图重复的重叠区域
    if (i > 0 && settings.removeDuplicates) {
      const prevImg = orderedImages[i - 1]
      const matchKey = `${prevImg.id}→${img.id}`
      const match = matchLookup.get(matchKey)

      if (match && match.confidence !== 'none') {
        const overlapH = match.overlapHeightB || match.overlapHeightA
        if (overlapH > 10 && overlapH < imgH * 0.95) {
          cropTop = Math.max(cropTop, overlapH)
        }

        // 水平对齐偏移累积
        if (settings.autoAlign && Math.abs(match.offsetX) < imgW * 0.4) {
          cumulativeOffsetX += match.offsetX
        }
      }
    }

    const effectiveW = Math.max(0, imgW - cropLeft - cropRight)
    const effectiveH = Math.max(0, imgH - cropTop - cropBottom)

    if (effectiveH > 0 && effectiveW > 0) {
      placements.push({
        image: img,
        destX: cumulativeOffsetX,
        destY: currentY,
        srcX: cropLeft,
        srcY: cropTop,
        srcW: effectiveW,
        srcH: effectiveH,
      })

      minGlobalX = Math.min(minGlobalX, cumulativeOffsetX)
      maxGlobalX = Math.max(maxGlobalX, cumulativeOffsetX + effectiveW)
      currentY += effectiveH
    }
  }

  if (placements.length === 0) {
    throw new Error('未计算出有效的放置区域')
  }

  // 计算全局画布宽度（考虑水平位移扩展）
  const canvasWidth = Math.max(1, maxGlobalX - minGlobalX)
  const totalHeight = currentY
  const truncated = totalHeight > MAX_CANVAS_HEIGHT
  const canvasHeight = Math.min(totalHeight, MAX_CANVAS_HEIGHT)

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  // 填充背景底色
  ctx.fillStyle = settings.backgroundColor
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // 绘制各个图块，保持原始高保真像素
  for (const p of placements) {
    if (p.destY >= canvasHeight) break
    if (!p.image.originalBitmap) continue

    const availableH = Math.min(p.srcH, canvasHeight - p.destY)
    if (availableH <= 0) continue

    // 偏移对齐归零到画布内部
    const drawX = p.destX - minGlobalX

    ctx.drawImage(
      p.image.originalBitmap,
      p.srcX, p.srcY,
      p.srcW, availableH,
      drawX, p.destY,
      p.srcW, availableH
    )
  }

  return {
    groupId: group.id,
    canvas,
    width: canvasWidth,
    height: canvasHeight,
    truncated,
  }
}

/**
 * 将 Canvas 安全导出为 Blob 文件
 */
export async function exportToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  options: ExportOptions
): Promise<Blob> {
  const mimeType =
    options.format === 'jpg' ? 'image/jpeg' :
    options.format === 'webp' ? 'image/webp' :
    'image/png'

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality: options.quality })
  } else {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('导出生成失败')),
        mimeType,
        options.quality
      )
    })
  }
}

/**
 * 触发浏览器本地下载
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

/**
 * 渲染高清预览缩略，按比例等比缩放
 */
export async function renderToCanvas(
  source: OffscreenCanvas,
  target: HTMLCanvasElement,
  maxPreviewWidth = 800
) {
  const scale = Math.min(1, maxPreviewWidth / source.width)
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))

  target.width = w
  target.height = h
  const ctx = target.getContext('2d')
  if (!ctx) return

  const bmp = await createImageBitmap(source)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
}
