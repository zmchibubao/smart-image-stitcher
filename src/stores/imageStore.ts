import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  ImageItem,
  MatchResult,
  StitchGroup,
  ProcessStatus,
  AppSettings,
  ExportOptions,
  ORBFeatures,
  OCRWord,
} from '../types'

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function fileToThumbnail(
  file: File,
  maxSize = 250
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        width: img.width,
        height: img.height,
      })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to load ${file.name}`))
    }
    img.src = url
  })
}

export const useImageStore = defineStore('image', () => {
  const images = ref<ImageItem[]>([])
  const matchResults = ref<MatchResult[]>([])
  const stitchGroups = ref<StitchGroup[]>([])
  const processStatus = ref<ProcessStatus>({
    step: 'idle',
    progress: 0,
    message: '等待上传图片',
  })
  const manualOrder = ref<string[]>([])
  const autoOrder = ref<string[]>([])
  const isCancelled = ref(false)
  const stitchedCanvases = ref<Map<number, OffscreenCanvas>>(new Map())

  const settings = ref<AppSettings>({
    autoSort: true,
    removeBlackBorders: true,
    autoAlign: true,
    removeDuplicates: true,
    enableOCR: false,
  })

  const exportOptions = ref<ExportOptions>({
    format: 'png',
    quality: 0.95,
    backgroundColor: '#ffffff',
  })

  // Ordered images for display
  const orderedImages = computed<ImageItem[]>(() => {
    const order = manualOrder.value.length > 0 ? manualOrder.value : images.value.map(i => i.id)
    return order
      .map(id => images.value.find(img => img.id === id))
      .filter(Boolean) as ImageItem[]
  })

  const isProcessing = computed(
    () => !['idle', 'done', 'error', 'cancelled', 'uploading'].includes(processStatus.value.step)
  )

  function getMatchBetween(idA: string, idB: string): MatchResult | undefined {
    return matchResults.value.find(
      m =>
        (m.imageIdA === idA && m.imageIdB === idB) ||
        (m.imageIdA === idB && m.imageIdB === idA)
    )
  }

  async function addImages(files: File[]) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Skip unsupported types
      if (!file.type.startsWith('image/')) continue

      const id = generateId()
      try {
        setProcessStatus({
          step: 'uploading',
          progress: Math.round((i / files.length) * 100),
          message: `正在加载图片 ${i + 1}/${files.length}`,
        })
        const { dataUrl, width, height } = await fileToThumbnail(file)
        const bitmap = await createImageBitmap(file)
        const item: ImageItem = {
          id,
          file,
          name: file.name,
          width,
          height,
          size: file.size,
          dataUrl,
          originalBitmap: bitmap,
          blackBorderTop: 0,
          blackBorderBottom: 0,
          blackBorderLeft: 0,
          blackBorderRight: 0,
          locked: false,
        }
        images.value.push(item)
        manualOrder.value.push(id)
      } catch (e) {
        console.error('Failed to load image', file.name, e)
      }
    }
    setProcessStatus({ step: 'idle', progress: 100, message: `已加载 ${images.value.length} 张图片` })
  }

  function removeImage(id: string) {
    const idx = images.value.findIndex(i => i.id === id)
    if (idx !== -1) {
      images.value[idx].originalBitmap?.close()
      images.value.splice(idx, 1)
    }
    manualOrder.value = manualOrder.value.filter(i => i !== id)
    autoOrder.value = autoOrder.value.filter(i => i !== id)
    matchResults.value = matchResults.value.filter(
      m => m.imageIdA !== id && m.imageIdB !== id
    )
    for (const group of stitchGroups.value) {
      group.imageIds = group.imageIds.filter(i => i !== id)
    }
  }

  function clearAll() {
    for (const img of images.value) {
      img.originalBitmap?.close()
    }
    images.value = []
    matchResults.value = []
    stitchGroups.value = []
    manualOrder.value = []
    autoOrder.value = []
    stitchedCanvases.value.clear()
    processStatus.value = { step: 'idle', progress: 0, message: '等待上传图片' }
  }

  function setManualOrder(ids: string[]) {
    manualOrder.value = [...ids]
  }

  function moveImage(id: string, newIndex: number) {
    const order = [...manualOrder.value]
    const oldIdx = order.indexOf(id)
    if (oldIdx === -1) return
    order.splice(oldIdx, 1)
    order.splice(newIndex, 0, id)
    manualOrder.value = order
  }

  function lockImage(id: string) {
    const img = images.value.find(i => i.id === id)
    if (img) img.locked = true
  }

  function unlockImage(id: string) {
    const img = images.value.find(i => i.id === id)
    if (img) img.locked = false
  }

  function setFeatures(id: string, features: ORBFeatures) {
    const img = images.value.find(i => i.id === id)
    if (img) img.features = features
  }

  function setOCRResult(id: string, text: string, words: OCRWord[]) {
    const img = images.value.find(i => i.id === id)
    if (img) {
      img.ocrText = text
      img.ocrWords = words
    }
  }

  function setMatchResult(result: MatchResult) {
    const existing = matchResults.value.findIndex(
      m =>
        (m.imageIdA === result.imageIdA && m.imageIdB === result.imageIdB) ||
        (m.imageIdA === result.imageIdB && m.imageIdB === result.imageIdA)
    )
    if (existing !== -1) {
      matchResults.value[existing] = result
    } else {
      matchResults.value.push(result)
    }
  }

  function setStitchGroups(groups: StitchGroup[]) {
    stitchGroups.value = groups
    const allOrdered: string[] = []
    for (const g of groups) allOrdered.push(...g.imageIds)
    autoOrder.value = allOrdered
    // Only update manual order if no manual overrides yet
    manualOrder.value = [...allOrdered]
  }

  function setProcessStatus(status: Partial<ProcessStatus>) {
    processStatus.value = { ...processStatus.value, ...status }
  }

  function restoreAutoOrder() {
    if (autoOrder.value.length > 0) {
      manualOrder.value = [...autoOrder.value]
    }
  }

  function setBorderInfo(id: string, top: number, bottom: number, left = 0, right = 0) {
    const img = images.value.find(i => i.id === id)
    if (img) {
      img.blackBorderTop = top
      img.blackBorderBottom = bottom
      img.blackBorderLeft = left
      img.blackBorderRight = right
    }
  }

  function cancelProcessing() {
    isCancelled.value = true
    setProcessStatus({ step: 'cancelled', progress: 0, message: '已取消' })
  }

  function resetCancel() {
    isCancelled.value = false
  }

  function setStitchedCanvas(groupId: number, canvas: OffscreenCanvas) {
    stitchedCanvases.value.set(groupId, canvas)
  }

  return {
    images,
    matchResults,
    stitchGroups,
    processStatus,
    manualOrder,
    autoOrder,
    settings,
    exportOptions,
    isCancelled,
    stitchedCanvases,
    orderedImages,
    isProcessing,
    getMatchBetween,
    addImages,
    removeImage,
    clearAll,
    setManualOrder,
    moveImage,
    lockImage,
    unlockImage,
    setFeatures,
    setOCRResult,
    setMatchResult,
    setStitchGroups,
    setProcessStatus,
    restoreAutoOrder,
    setBorderInfo,
    cancelProcessing,
    resetCancel,
    setStitchedCanvas,
  }
})
