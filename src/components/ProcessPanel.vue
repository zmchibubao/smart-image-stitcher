<script setup lang="ts">
import { computed } from 'vue'
import { useImageStore } from '../stores/imageStore'
import { runPipeline } from '../core/pipeline'
import { loadOpenCV, resetOpenCVLoader } from '../utils/opencvLoader'

const store = useImageStore()

const isRunning = computed(() => store.isProcessing)

const stepLabel = computed(() => {
  const s = store.processStatus
  const labels: Record<string, string> = {
    idle: '待机就绪',
    uploading: '加载图片',
    'loading-cv': '初始化视觉引擎',
    'extracting-features': '分析图像特征',
    ocr: 'OCR文字识别',
    matching: '计算重叠关系',
    ordering: '推断排列顺序',
    'detecting-borders': '清理无效黑边',
    stitching: '合成无缝长图',
    done: '拼接完成',
    error: '处理异常',
    cancelled: '已取消任务',
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
  store.setProcessStatus({ step: 'loading-cv', progress: 0, message: '正在启动处理流水线...' })

  // 获取当前用户确认的图片队列
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
      onProgress: (step, progress, message, engine) => {
        if (engine) store.setActiveEngine(engine)
        store.setProcessStatus({ step: step as any, progress, message })
      },
      onError: (err) => {
        store.setProcessStatus({ step: 'error', progress: 0, message: err.message, error: err.message })
      },
      isCancelled: () => store.isCancelled,
    },
    store.exportOptions.backgroundColor,
    store.manualOrder
  )

  if (result && !store.isCancelled) {
    store.setActiveEngine(result.engineUsed)
    store.setStitchGroups(result.groups)
    for (const m of result.matchResults || []) {
      store.setMatchResult(m)
    }
    for (const [gid, canvas] of result.stitchedCanvases) {
      store.setStitchedCanvas(gid, canvas)
    }
    store.setProcessStatus({
      step: 'done',
      progress: 100,
      message: `长图拼接完成！已生成 ${result.groups.length} 组高清长图`,
    })
  }
}

function cancelProcessing() {
  store.cancelProcessing()
}

async function retryOpenCV() {
  resetOpenCVLoader()
  try {
    store.setProcessStatus({ step: 'loading-cv', progress: 10, message: '正在重新加载 OpenCV.js...' })
    await loadOpenCV(10000)
    store.setActiveEngine('opencv')
    store.setProcessStatus({ step: 'idle', progress: 0, message: 'OpenCV.js 重新加载成功，可以开始处理' })
  } catch (err: any) {
    store.setProcessStatus({ step: 'idle', progress: 0, message: `加载失败: ${err?.message}，已自动启用备用引擎` })
  }
}
</script>

<template>
  <div class="process-panel card">
    <!-- Engine Status Pill -->
    <div class="engine-bar">
      <span class="engine-pill" :class="store.activeEngine === 'opencv' ? 'pill-opencv' : 'pill-canvas'">
        {{ store.activeEngine === 'opencv' ? '🚀 深度模式 (OpenCV.js 激活)' : '⚡ 高性能模式 (原生 Canvas 引擎)' }}
      </span>
      <button
        v-if="store.activeEngine === 'canvas' && !isRunning"
        class="btn btn-secondary btn-sm"
        @click="retryOpenCV"
        title="尝试加载 OpenCV.js 深度视觉模型"
      >
        🔄 尝试加载 OpenCV
      </button>
    </div>

    <!-- Settings -->
    <div class="settings-row">
      <label class="toggle-label" title="自动根据内容重叠推断图片顺序">
        <input type="checkbox" v-model="store.settings.autoSort" />
        <span class="toggle-text">🔀 自动推断顺序</span>
      </label>
      <label class="toggle-label" title="智能识别并裁切截图边缘黑条">
        <input type="checkbox" v-model="store.settings.removeBlackBorders" />
        <span class="toggle-text">✂️ 自动清理黑边</span>
      </label>
      <label class="toggle-label" title="检测并去除相邻图片的重复段落/区域">
        <input type="checkbox" v-model="store.settings.removeDuplicates" />
        <span class="toggle-text">🗑 去除重复区域</span>
      </label>
      <label class="toggle-label" title="校正截图间的水平错位">
        <input type="checkbox" v-model="store.settings.autoAlign" />
        <span class="toggle-text">📐 水平对齐校正</span>
      </label>
    </div>

    <!-- Action buttons -->
    <div class="action-row">
      <button
        class="btn btn-primary start-btn"
        :disabled="isRunning || store.images.length === 0"
        @click="startProcessing"
      >
        {{ isRunning ? '正在处理中...' : '🚀 开始智能分析与拼接' }}
      </button>
      <button
        v-if="isRunning"
        class="btn btn-danger"
        @click="cancelProcessing"
      >
        取消任务
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
        <span class="result-label">张输入图片</span>
      </div>
      <div class="result-sep">→</div>
      <div class="result-item">
        <span class="result-num">{{ store.stitchGroups.length }}</span>
        <span class="result-label">个拼接长图组</span>
      </div>
      <div class="result-sep">→</div>
      <div class="result-item">
        <span class="result-num">{{ store.matchResults.filter(m => m.confidence !== 'none').length }}</span>
        <span class="result-label">处有效重叠</span>
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

.engine-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border);
}

.engine-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
}

.pill-opencv {
  background: #dcfce7;
  color: #15803d;
}

.pill-canvas {
  background: #e0f2fe;
  color: #0369a1;
}

[data-theme='dark'] .pill-opencv {
  background: #14532d;
  color: #4ade80;
}

[data-theme='dark'] .pill-canvas {
  background: #0c4a6e;
  color: #38bdf8;
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
  font-weight: 500;
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
