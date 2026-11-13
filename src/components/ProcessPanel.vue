<script setup lang="ts">
import { computed } from 'vue'
import { useImageStore } from '../stores/imageStore'
import { runPipeline } from '../core/pipeline'

const store = useImageStore()

const isRunning = computed(() => store.isProcessing)
const stepLabel = computed(() => {
  const s = store.processStatus
  const labels: Record<string, string> = {
    idle: '待机',
    uploading: '加载图片',
    'loading-cv': '加载OpenCV',
    'extracting-features': '提取特征',
    ocr: 'OCR识别',
    matching: '图像匹配',
    ordering: '推断顺序',
    'detecting-borders': '检测黑边',
    stitching: '拼接图片',
    done: '完成',
    error: '错误',
    cancelled: '已取消',
  }
  return labels[s.step] || s.step
})

const stepIcon = computed(() => {
  const s = store.processStatus.step
  const icons: Record<string, string> = {
    idle: '⚡',
    uploading: '📁',
    'loading-cv': '⚙️',
    'extracting-features': '🔍',
    ocr: '📝',
    matching: '🔗',
    ordering: '📋',
    'detecting-borders': '✂️',
    stitching: '🧩',
    done: '✅',
    error: '❌',
    cancelled: '⛔',
  }
  return icons[s] || '⚡'
})

async function startProcessing() {
  if (store.images.length < 1) return

  store.resetCancel()
  store.setProcessStatus({ step: 'loading-cv', progress: 0, message: '初始化中...' })

  // Get ordered images for processing
  const orderedIds = store.manualOrder.length > 0
    ? store.manualOrder
    : store.images.map(i => i.id)
  const orderedImages = orderedIds
    .map(id => store.images.find(i => i.id === id))
    .filter(Boolean) as import('../types').ImageItem[]

  const result = await runPipeline(
    orderedImages,
    store.settings,
    {
      onProgress: (step, progress, message) => {
        store.setProcessStatus({ step: step as any, progress, message })
      },
      onError: (err) => {
        store.setProcessStatus({ step: 'error', progress: 0, message: err.message, error: err.message })
      },
      isCancelled: () => store.isCancelled,
    },
    store.exportOptions.backgroundColor
  )

  if (result && !store.isCancelled) {
    store.setStitchGroups(result.groups)
    for (const m of result.matchResults || []) {
      store.setMatchResult(m)
    }
    for (const [gid, canvas] of result.stitchedCanvases) {
      store.setStitchedCanvas(gid, canvas)
    }
    store.setProcessStatus({ step: 'done', progress: 100, message: '拼接完成！' })
  }
}

function cancelProcessing() {
  store.cancelProcessing()
}
</script>

<template>
  <div class="process-panel card">
    <!-- Settings -->
    <div class="settings-row">
      <label class="toggle-label">
        <input type="checkbox" v-model="store.settings.autoSort" />
        <span class="toggle-text">🔀 自动排序</span>
      </label>
      <label class="toggle-label">
        <input type="checkbox" v-model="store.settings.removeBlackBorders" />
        <span class="toggle-text">✂️ 去除黑边</span>
      </label>
      <label class="toggle-label">
        <input type="checkbox" v-model="store.settings.removeDuplicates" />
        <span class="toggle-text">🗑 去除重复</span>
      </label>
      <label class="toggle-label">
        <input type="checkbox" v-model="store.settings.autoAlign" />
        <span class="toggle-text">📐 自动对齐</span>
      </label>
    </div>

    <!-- Action buttons -->
    <div class="action-row">
      <button
        class="btn btn-primary start-btn"
        :disabled="isRunning || store.images.length === 0"
        @click="startProcessing"
      >
        {{ isRunning ? '处理中...' : '🚀 开始智能分析与拼接' }}
      </button>
      <button
        v-if="isRunning"
        class="btn btn-danger"
        @click="cancelProcessing"
      >
        取消
      </button>
    </div>

    <!-- Progress -->
    <div v-if="store.processStatus.step !== 'idle'" class="progress-section">
      <div class="progress-header">
        <span class="step-icon">{{ stepIcon }}</span>
        <span class="step-name">{{ stepLabel }}</span>
        <span class="step-pct">{{ store.processStatus.progress }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: store.processStatus.progress + '%' }"></div>
      </div>
      <p class="progress-message" :class="{ error: store.processStatus.step === 'error' }">
        {{ store.processStatus.message }}
      </p>
    </div>

    <!-- Results summary -->
    <div v-if="store.processStatus.step === 'done'" class="results-summary">
      <div class="result-item">
        <span class="result-num">{{ store.images.length }}</span>
        <span class="result-label">张图片</span>
      </div>
      <div class="result-sep">→</div>
      <div class="result-item">
        <span class="result-num">{{ store.stitchGroups.length }}</span>
        <span class="result-label">个拼接组</span>
      </div>
      <div class="result-sep">→</div>
      <div class="result-item">
        <span class="result-num">{{ store.matchResults.filter(m => m.confidence !== 'none').length }}</span>
        <span class="result-label">个匹配</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process-panel {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary);
}

.toggle-text {
  font-size: 13px;
  color: var(--text);
  user-select: none;
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.start-btn {
  font-size: 15px;
  padding: 12px 24px;
  font-weight: 600;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-icon {
  font-size: 16px;
}

.step-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.step-pct {
  font-size: 13px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

.progress-message {
  font-size: 12px;
  color: var(--text-secondary);
}

.progress-message.error {
  color: var(--danger);
}

.results-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  flex-wrap: wrap;
}

.result-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.result-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
}

.result-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.result-sep {
  font-size: 20px;
  color: var(--text-muted);
}
</style>
