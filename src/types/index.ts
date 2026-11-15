export interface ImageItem {
  id: string
  file: File
  name: string
  width: number
  height: number
  size: number
  dataUrl: string               // thumbnail
  originalBitmap?: ImageBitmap
  features?: ORBFeatures
  canvasFeature?: any
  ocrText?: string
  ocrWords?: OCRWord[]
  blackBorderTop: number
  blackBorderBottom: number
  blackBorderLeft: number
  blackBorderRight: number
  locked: boolean
  group?: number
  isDuplicate?: boolean
}

export interface ORBFeatures {
  keypoints: KeyPoint[]
  descriptors: number[][]
  imageId: string
  scale: number                 // scale used during extraction (1.0 = original)
}

export interface KeyPoint {
  x: number
  y: number
  size: number
  angle: number
  response: number
  octave: number
}

export interface OCRWord {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface MatchResult {
  imageIdA: string
  imageIdB: string
  score: number                  // 0-1
  offsetX: number                // horizontal offset of B relative to A (pixels in original scale)
  offsetY: number                // vertical offset: negative = B is below A
  overlapHeightA: number         // pixels at bottom of A that overlap
  overlapHeightB: number         // pixels at top of B that overlap
  confidence: 'high' | 'medium' | 'low' | 'none'
  direction: 'A_before_B' | 'B_before_A' | 'unknown'
  inlierCount: number
  seamCut?: number
  contentDiff?: number
  matchedLinesCount?: number
  decision?: 'accepted' | 'rejected' | 'candidate'
}

export interface StitchGroup {
  id: number
  imageIds: string[]             // in correct order
  matches: MatchResult[]
  name?: string
}

export type ProcessStep =
  | 'idle'
  | 'uploading'
  | 'loading-cv'
  | 'extracting-features'
  | 'ocr'
  | 'matching'
  | 'ordering'
  | 'detecting-borders'
  | 'stitching'
  | 'done'
  | 'error'
  | 'cancelled'

export interface ProcessStatus {
  step: ProcessStep
  progress: number               // 0-100
  message: string
  error?: string
  currentImageIndex?: number
  totalImages?: number
}

export interface AppSettings {
  autoSort: boolean
  removeBlackBorders: boolean
  autoAlign: boolean
  removeDuplicates: boolean
  enableOCR: boolean
}

export interface ExportOptions {
  format: 'png' | 'jpg' | 'webp'
  quality: number
  backgroundColor: string
}
