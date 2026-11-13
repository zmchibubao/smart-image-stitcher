<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useImageStore } from '../stores/imageStore'
import { renderToCanvas } from '../core/stitcher'

const store = useImageStore()
const canvasRef = ref<HTMLCanvasElement>()
const activeGroupId = ref(0)
const zoom = ref(1)
const isLoading = ref(false)

const groups = computed(() => store.stitchGroups)
const activeCanvas = computed(() => store.stitchedCanvases.get(activeGroupId.value))

watch([activeCanvas, zoom], async () => {
  if (!canvasRef.value || !activeCanvas.value) return
  isLoading.value = true
  try {
    const parentW = canvasRef.value.parentElement?.clientWidth || 800
    const previewW = Math.round(parentW * Math.min(zoom.value, 1))
    await renderToCanvas(activeCanvas.value, canvasRef.value, previewW)
  } finally {
    isLoading.value = false
  }
})

function zoomIn() { zoom.value = Math.min(zoom.value * 1.5, 4) }
function zoomOut() { zoom.value = Math.max(zoom.value / 1.5, 0.1) }
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

    <!-- Toolbar -->
    <div class="preview-toolbar">
      <div class="zoom-controls">
        <button class="btn btn-secondary btn-sm" @click="zoomOut" :disabled="zoom <= 0.1">－</button>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <button class="btn btn-secondary btn-sm" @click="zoomIn" :disabled="zoom >= 4">＋</button>
        <button class="btn btn-secondary btn-sm" @click="resetZoom">重置</button>
      </div>
      <span v-if="canvasSize" class="size-label">{{ canvasSize }}</span>
    </div>

    <!-- Canvas preview -->
    <div class="canvas-wrap">
      <div v-if="isLoading" class="loading-overlay">渲染中...</div>
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
