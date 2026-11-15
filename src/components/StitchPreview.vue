<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useImageStore } from '../stores/imageStore'
import { renderToCanvas } from '../core/stitcher'

const store = useImageStore()
const canvasRef = ref<HTMLCanvasElement>()
const activeGroupId = ref(0)
const zoom = ref(1)
const isLoading = ref(false)
const showDebugPanel = ref(false)

const groups = computed(() => store.stitchGroups)
const activeCanvas = computed(() => store.stitchedCanvases.get(activeGroupId.value))
const activeQualityReport = computed(() => store.qualityReports.get(activeGroupId.value))

async function updatePreview() {
  await nextTick()
  if (!canvasRef.value || !activeCanvas.value) return
  isLoading.value = true
  try {
    const parentW = canvasRef.value.parentElement?.clientWidth || 800
    const previewW = Math.round(parentW * Math.min(zoom.value, 1.5))
    await renderToCanvas(activeCanvas.value, canvasRef.value, previewW)
  } catch (e) {
    console.warn('Preview render failed:', e)
  } finally {
    isLoading.value = false
  }
}

watch([activeCanvas, zoom, activeGroupId], () => {
  updatePreview()
}, { immediate: true })

function zoomIn() { zoom.value = Math.min(zoom.value * 1.25, 3) }
function zoomOut() { zoom.value = Math.max(zoom.value / 1.25, 0.2) }
function resetZoom() { zoom.value = 1 }

const canvasSize = computed(() => {
  const c = activeCanvas.value
  if (!c) return ''
  return `${c.width} × ${c.height} px`
})
</script>

<template>
  <div class="stitch-preview card">
    <!-- Group tabs -->
    <div v-if="groups.length > 1" class="group-tabs">
      <button
        v-for="g in groups"
        :key="g.id"
        class="tab-btn"
        :class="{ active: activeGroupId === g.id }"
        @click="activeGroupId = g.id"
      >
        第 {{ g.id + 1 }} 组 ({{ g.imageIds.length }} 张)
      </button>
    </div>

    <!-- Quality Score Badge & Assessment Banner -->
    <div v-if="activeQualityReport" class="quality-banner">
      <div class="quality-main">
        <div class="quality-score-box">
          <span class="score-num">{{ activeQualityReport.overallScore }}</span>
          <span class="score-unit">分</span>
        </div>
        <div class="quality-text">
          <div class="quality-title-line">
            <span class="quality-title">拼接质量评估：</span>
            <span
              class="quality-tag"
              :class="{
                'tag-perfect': activeQualityReport.overallScore >= 90,
                'tag-good': activeQualityReport.overallScore >= 75 && activeQualityReport.overallScore < 90,
                'tag-warning': activeQualityReport.overallScore < 75
              }"
            >
              {{ activeQualityReport.rating }}
            </span>
          </div>
          <div class="quality-metrics-line">
            <span>接缝总数: {{ activeQualityReport.metrics.totalSeams }} 处</span>
            <span>高置信对齐: {{ activeQualityReport.metrics.highConfidenceSeams }} 处</span>
            <span>平均重叠: {{ activeQualityReport.metrics.averageOverlapH }} px</span>
          </div>
        </div>
      </div>
      <button
        class="btn btn-secondary btn-sm debug-toggle-btn"
        @click="showDebugPanel = !showDebugPanel"
      >
        {{ showDebugPanel ? '收起调试分析 ▲' : '接缝与重叠调试 ▼' }}
      </button>
    </div>

    <!-- Warnings if any -->
    <div v-if="activeQualityReport?.warnings && activeQualityReport.warnings.length > 0" class="warning-box">
      <div v-for="(w, idx) in activeQualityReport.warnings" :key="idx" class="warning-item">
        ⚠️ {{ w }}
      </div>
    </div>

    <!-- Collapsible Seam Debug Details -->
    <div v-if="showDebugPanel && activeQualityReport" class="debug-panel">
      <h4 class="debug-title">🔍 接缝与重叠对齐细节（开发调试模式）</h4>
      <div class="seam-list">
        <div
          v-for="(s, sidx) in activeQualityReport.seamQualities"
          :key="sidx"
          class="seam-item"
          :class="`seam-${s.status}`"
        >
          <div class="seam-header">
            <span class="seam-pair">接缝 {{ sidx + 1 }}: {{ s.upperName }} ➔ {{ s.lowerName }}</span>
            <span class="seam-status-badge">{{ s.status === 'perfect' ? '✅ 完美对齐' : s.status === 'good' ? '✨ 良好无缝' : '⚠️ 需检查' }}</span>
          </div>
          <div class="seam-body">
            <span>重叠高度: <strong>{{ s.overlapH }}px</strong></span>
            <span>水平偏移: <strong>{{ s.dx }}px</strong></span>
            <span>无损接缝行: <strong>第 {{ s.seamY }} 行 (空白谷底)</strong></span>
            <span>匹配置信度: <strong>{{ s.matchScore }}% ({{ s.alignmentConfidence }})</strong></span>
          </div>
          <div v-if="s.note" class="seam-note">{{ s.note }}</div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="preview-toolbar">
      <div class="zoom-controls">
        <button class="btn btn-secondary btn-sm" @click="zoomOut" :disabled="zoom <= 0.2">－</button>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <button class="btn btn-secondary btn-sm" @click="zoomIn" :disabled="zoom >= 3">＋</button>
        <button class="btn btn-secondary btn-sm" @click="resetZoom">重置</button>
      </div>
      <span v-if="canvasSize" class="size-label">{{ canvasSize }}</span>
    </div>

    <!-- Canvas preview -->
    <div class="canvas-wrap">
      <div v-if="isLoading" class="loading-overlay">渲染预览中...</div>
      <canvas
        ref="canvasRef"
        class="preview-canvas"
        :style="{ display: activeCanvas ? 'block' : 'none' }"
      ></canvas>
      <div v-if="!activeCanvas" class="no-preview">
        <p>暂无预览</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stitch-preview {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition);
}

.tab-btn.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.quality-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  gap: 12px;
  flex-wrap: wrap;
}

.quality-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quality-score-box {
  background: var(--primary-light, #e0e7ff);
  color: var(--primary, #4338ca);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.score-num {
  font-size: 20px;
}

.score-unit {
  font-size: 11px;
}

.quality-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quality-title-line {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.quality-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.tag-perfect {
  background: #d1fae5;
  color: #065f46;
}

.tag-good {
  background: #e0f2fe;
  color: #0369a1;
}

.tag-warning {
  background: #fef3c7;
  color: #92400e;
}

.quality-metrics-line {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 12px;
}

.warning-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-item {
  font-size: 12px;
  color: #b45309;
}

.debug-panel {
  background: var(--bg-tertiary, #f8fafc);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.debug-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--text-secondary);
}

.seam-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.seam-item {
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.seam-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
}

.seam-body {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.seam-note {
  font-size: 11px;
  color: #d97706;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-label {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.size-label {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.canvas-wrap {
  position: relative;
  overflow: auto;
  max-height: 70vh;
  background: repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 0 0 / 20px 20px;
  border-radius: var(--radius-sm);
  min-height: 200px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  opacity: 0.9;
  font-size: 14px;
  color: var(--text-secondary);
  z-index: 10;
}

.preview-canvas {
  max-width: 100%;
  display: block;
  box-shadow: var(--shadow-md);
}

.no-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 200px;
  color: var(--text-muted);
}
</style>
