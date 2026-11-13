import type { ImageItem, MatchResult, StitchGroup, ExportOptions } from '../types'

export interface StitchResult {
  groupId: number
  canvas: OffscreenCanvas
  width: number
  height: number
  truncated: boolean
}

const MAX_CANVAS_HEIGHT = 32767 // Browser safe limit

/**
 * Stitch a group of images into one vertical long image.
 * Images should already be in the correct order.
 */
export async function stitchGroup(
  group: StitchGroup,
  images: ImageItem[],
  allMatches: MatchResult[],
  settings: { removeBlackBorders: boolean; removeDuplicates: boolean; backgroundColor: string }
): Promise<StitchResult> {
  // Build ordered image list
  const orderedImages = group.imageIds
    .map(id => images.find(img => img.id === id))
    .filter(Boolean) as ImageItem[]

  if (orderedImages.length === 0) {
    throw new Error('No images in group')
  }

  // Build a lookup for sequential matches
  const matchLookup = new Map<string, MatchResult>()
  for (const m of allMatches) {
    matchLookup.set(`${m.imageIdA}→${m.imageIdB}`, m)
    // Also try the reversed key since direction may vary
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

  // Plan the layout
  interface Placement {
    image: ImageItem
    destY: number
    srcX: number
    srcY: number          // start reading from this Y in the source image
    srcW: number
    srcH: number          // how many pixels of height to draw
  }

  const placements: Placement[] = []
  let currentY = 0
  let maxWidth = 0

  for (let i = 0; i < orderedImages.length; i++) {
    const img = orderedImages[i]
    if (!img.originalBitmap) continue

    const imgH = img.originalBitmap.height
    const imgW = img.originalBitmap.width

    // Start and end crop within this image
    let cropTop = settings.removeBlackBorders ? (img.blackBorderTop || 0) : 0
    let cropBottom = settings.removeBlackBorders ? (img.blackBorderBottom || 0) : 0

    // If this is not the first image, check how much overlaps with previous
    if (i > 0 && settings.removeDuplicates) {
      const prevImg = orderedImages[i - 1]
      const matchKey = `${prevImg.id}→${img.id}`
      const match = matchLookup.get(matchKey)

      if (match && match.overlapHeightB > 0 && match.confidence !== 'none') {
        // Skip the top overlapHeightB pixels of this image
        cropTop = Math.max(cropTop, match.overlapHeightB)
      }
    }

    const effectiveH = Math.max(0, imgH - cropTop - cropBottom)

    if (effectiveH > 0) {
      placements.push({
        image: img,
        destY: currentY,
        srcX: 0,
        srcY: cropTop,
        srcW: imgW,
        srcH: effectiveH,
      })
      currentY += effectiveH
      maxWidth = Math.max(maxWidth, imgW)
    }
  }

  if (placements.length === 0) {
    throw new Error('No valid placements computed')
  }

  const totalHeight = currentY
  const truncated = totalHeight > MAX_CANVAS_HEIGHT
  const canvasHeight = Math.min(totalHeight, MAX_CANVAS_HEIGHT)

  const canvas = new OffscreenCanvas(maxWidth, canvasHeight)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  // Fill background
  ctx.fillStyle = settings.backgroundColor
  ctx.fillRect(0, 0, maxWidth, canvasHeight)

  // Draw each placement
  for (const p of placements) {
    if (p.destY >= canvasHeight) break
    if (!p.image.originalBitmap) continue

    const availableH = Math.min(p.srcH, canvasHeight - p.destY)
    if (availableH <= 0) continue

    // Center horizontally if narrower than canvas
    const destX = Math.floor((maxWidth - p.srcW) / 2)

    ctx.drawImage(
      p.image.originalBitmap,
      p.srcX, p.srcY,         // source position
      p.srcW, availableH,     // source size
      destX, p.destY,         // destination position
      p.srcW, availableH      // destination size
    )
  }

  return {
    groupId: group.id,
    canvas,
    width: maxWidth,
    height: canvasHeight,
    truncated,
  }
}

/**
 * Export a canvas to a Blob
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
        blob => blob ? resolve(blob) : reject(new Error('Export failed')),
        mimeType,
        options.quality
      )
    })
  }
}

/**
 * Trigger browser download of a Blob
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Render an OffscreenCanvas to an HTML canvas for preview
 */
export async function renderToCanvas(
  source: OffscreenCanvas,
  target: HTMLCanvasElement,
  maxPreviewWidth = 800
) {
  const scale = Math.min(1, maxPreviewWidth / source.width)
  target.width = Math.round(source.width * scale)
  target.height = Math.round(source.height * scale)
  const ctx = target.getContext('2d')!
  
  // Transfer via ImageBitmap
  const bmp = await createImageBitmap(source)
  ctx.drawImage(bmp, 0, 0, target.width, target.height)
  bmp.close()
}
