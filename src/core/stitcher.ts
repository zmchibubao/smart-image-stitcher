import type { ImageItem, MatchResult, StitchGroup, ExportOptions } from '../types'

export interface StitchResult {
  groupId: number
  canvas: OffscreenCanvas
  width: number
  height: number
  truncated: boolean
  seamDetails?: Array<{
    upperId: string
    lowerId: string
    overlapH: number
    dx: number
    seamY: number
    confidence: string
  }>
}

const MAX_CANVAS_HEIGHT = 32767 // 现代浏览器 Canvas 安全极限高度

/**
 * 将一组已经排好序的图片合成为一张高精度无缝纵向长图：
 * 1. 采用文字行空白谷底接缝算法（Seam Cut），彻底避免文字横向截断；
 * 2. 严格按有效区域物理坐标对齐，消除黑边与重复段落；
 * 3. 严格保留高分辨率手写笔迹、荧光笔重点与红色批注，原始像素无损输出。
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
      direction: m.direction === 'A_before_B' ? 'B_before_A' : 'A_before_B',
    })
  }

  // 1. 计算相邻图片间的接缝参数
  interface SeamInfo {
    upperId: string
    lowerId: string
    overlapH: number
    dx: number
    seam: number
    confidence: string
  }

  const seams: SeamInfo[] = []
  for (let i = 0; i < orderedImages.length - 1; i++) {
    const upImg = orderedImages[i]
    const lowImg = orderedImages[i + 1]
    const match = matchLookup.get(`${upImg.id}→${lowImg.id}`)

    let overlapH = 0
    let dx = 0
    let seam = 0
    let confidence = 'none'

    if (match && match.confidence !== 'none' && settings.removeDuplicates) {
      overlapH = Math.max(0, match.overlapHeightA || match.overlapHeightB)
      dx = settings.autoAlign ? match.offsetX : 0
      confidence = match.confidence
      // 使用在空白文本行处计算的无损接缝位置，默认切在中间
      seam = match.seamCut !== undefined ? match.seamCut : Math.floor(overlapH / 2)
    }

    seams.push({
      upperId: upImg.id,
      lowerId: lowImg.id,
      overlapH,
      dx,
      seam,
      confidence,
    })
  }

  // 2. 规划每个图块的切割和放置区域
  interface SlicePlan {
    img: ImageItem
    cropLeft: number
    cropTop: number
    validW: number
    srcY: number
    keepH: number
    destX: number
  }

  const slices: SlicePlan[] = []
  let cumulativeDx = 0
  let minDx = 0
  let maxRight = 0

  for (let i = 0; i < orderedImages.length; i++) {
    const img = orderedImages[i]
    if (!img.originalBitmap) continue

    const origW = img.originalBitmap.width
    const origH = img.originalBitmap.height

    const cropLeft = settings.removeBlackBorders ? (img.blackBorderLeft || 0) : 0
    const cropRight = settings.removeBlackBorders ? (img.blackBorderRight || 0) : 0
    const cropTop = settings.removeBlackBorders ? (img.blackBorderTop || 0) : 0
    const cropBottom = settings.removeBlackBorders ? (img.blackBorderBottom || 0) : 0

    const validW = Math.max(10, origW - cropLeft - cropRight)
    const validH = Math.max(10, origH - cropTop - cropBottom)

    let srcY = 0
    if (i > 0 && seams[i - 1].overlapH > 0) {
      srcY = seams[i - 1].seam
      cumulativeDx += seams[i - 1].dx
    }

    let keepH = validH - srcY
    if (i < orderedImages.length - 1 && seams[i].overlapH > 0) {
      const overlapStart = validH - seams[i].overlapH
      const targetEnd = overlapStart + seams[i].seam
      keepH = Math.max(5, targetEnd - srcY)
    }

    slices.push({
      img,
      cropLeft,
      cropTop,
      validW,
      srcY,
      keepH,
      destX: cumulativeDx,
    })

    minDx = Math.min(minDx, cumulativeDx)
    maxRight = Math.max(maxRight, cumulativeDx + validW)
  }

  if (slices.length === 0) {
    throw new Error('拼接组中没有有效切片')
  }

  // 3. 计算长图尺寸
  const canvasWidth = Math.max(100, Math.round(maxRight - minDx))
  let totalHeight = 0
  for (const s of slices) {
    totalHeight += s.keepH
  }

  const truncated = totalHeight > MAX_CANVAS_HEIGHT
  const canvasHeight = Math.min(totalHeight, MAX_CANVAS_HEIGHT)

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  // 填充背景底色
  ctx.fillStyle = settings.backgroundColor || '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // 4. 严格采用原图高分辨率像素进行绘制，保留手写笔迹与荧光笔
  let currentY = 0
  for (const s of slices) {
    if (currentY >= canvasHeight) break
    if (!s.img.originalBitmap) continue

    const availableH = Math.min(s.keepH, canvasHeight - currentY)
    if (availableH <= 0) continue

    const drawX = Math.round(s.destX - minDx)

    ctx.drawImage(
      s.img.originalBitmap,
      s.cropLeft,
      s.cropTop + s.srcY,
      s.validW,
      availableH,
      drawX,
      currentY,
      s.validW,
      availableH
    )

    currentY += availableH
  }

  return {
    groupId: group.id,
    canvas,
    width: canvasWidth,
    height: canvasHeight,
    truncated,
    seamDetails: seams.map(s => ({
      upperId: s.upperId,
      lowerId: s.lowerId,
      overlapH: s.overlapH,
      dx: s.dx,
      seamY: s.seam,
      confidence: s.confidence,
    })),
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
    options.format === 'jpg'
      ? 'image/jpeg'
      : options.format === 'webp'
        ? 'image/webp'
        : 'image/png'

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality: options.quality })
  } else {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('导出生成失败'))),
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
