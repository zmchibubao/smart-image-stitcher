<script setup lang="ts">
import { ref, computed } from 'vue'
import { useImageStore } from '../stores/imageStore'
import { exportToBlob, downloadBlob } from '../core/stitcher'

const store = useImageStore()
const isExporting = ref(false)
const exportProgress = ref(0)

const groups = computed(() => store.stitchGroups)

async function exportGroup(groupId: number) {
  const canvas = store.stitchedCanvases.get(groupId)
  if (!canvas) return

  isExporting.value = true
  exportProgress.value = 10

  try {
    const blob = await exportToBlob(canvas, store.exportOptions)
    exportProgress.value = 90
    const ext = store.exportOptions.format
    const filename = `stitched-group${groupId + 1}.${ext}`
    downloadBlob(blob, filename)
    exportProgress.value = 100
  } catch (e) {
    alert('导出失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    setTimeout(() => {
      isExporting.value = false
      exportProgress.value = 0
    }, 1000)
  }
}

async function exportAll() {
  for (const group of groups.value) {
    await exportGroup(group.id)
    await new Promise(r => setTimeout(r, 300))
  }
}

const canvasSizes = computed(() => {
  const sizes: Record<number, string> = {}
  for (const [gid, canvas] of store.stitchedCanvases) {
    sizes[gid] = `${canvas.width} × ${canvas.height}px`
  }
  return sizes
})
</script>

<template>
  <div class="export-panel card">
    <!-- Format options -->
    <div class="options-grid">
      <div class="option-group">
        <label class="option-label">输出格式</label>
        <div class="format-btns">
          <button
            v-for="fmt in ['png', 'jpg', 'webp'] as const"
            :key="fmt"
            class="fmt-btn"
            :class="{ active: store.exportOptions.format === fmt }"
            @click="store.exportOptions.format = fmt"
          >
            {{ fmt.toUpperCase() }}
          </button>
        </div>
      </div>

      <div class="option-group" v-if="store.exportOptions.format !== 'png'">
        <label class="option-label">
          质量 {{ Math.round(store.exportOptions.quality * 100) }}%
        </label>
        <input
          type="range"
          min="0.5"
          max="1"
          step="0.05"
          v-model.number="store.exportOptions.quality"
          class="quality-slider"
        />
      </div>

      <div class="option-group">
        <label class="option-label">背景颜色</label>
        <input type="color" v-model="store.exportOptions.backgroundColor" class="color-picker" />
      </div>
    </div>

    <!-- Per-group export -->
    <div class="export-groups">
      <div
        v-for="group in groups"
        :key="group.id"
        class="export-row"
      >
        <div class="export-info">
          <span class="export-title">第 {{ group.id + 1 }} 组</span>
          <span class="export-meta">{{ group.imageIds.length }} 张图片</span>
          <span v-if="canvasSizes[group.id]" class="export-size">{{ canvasSizes[group.id] }}</span>
        </div>
        <button
          class="btn btn-primary"
          :disabled="isExporting || !store.stitchedCanvases.has(group.id)"
          @click="exportGroup(group.id)"
        >
          ⬇ 下载
        </button>
      </div>

      <button
        v-if="groups.length > 1"
        class="btn btn-secondary export-all-btn"
        :disabled="isExporting"
        @click="exportAll"
      >
        ⬇ 下载全部 ({{ groups.length }} 个文件)
      </button>
    </div>

    <!-- Progress -->
    <div v-if="isExporting" class="export-progress">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: exportProgress + '%' }"></div>
      </div>
      <p class="progress-label">正在导出...</p>
    </div>

    <!-- Notes -->
    <div class="export-notes">
      <p>💡 PNG 格式无损，文件较大；JPG/WEBP 有损压缩，文件更小</p>
      <p>⚠️ 如果图片超高（>32767px），可能在部分浏览器被截断</p>
    </div>
  </div>
</template>

<style scoped>
.export-panel {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.options-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: flex-end;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.format-btns {
  display: flex;
  gap: 4px;
}

.fmt-btn {
  padding: 6px 14px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
}

.fmt-btn.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.quality-slider {
  width: 160px;
  accent-color: var(--primary);
}

.color-picker {
  width: 48px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  cursor: pointer;
  padding: 2px;
  background: var(--bg-secondary);
}

.export-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.export-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  gap: 12px;
}

.export-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.export-title {
  font-weight: 600;
  font-size: 14px;
}

.export-meta, .export-size {
  font-size: 12px;
  color: var(--text-secondary);
}

.export-all-btn {
  align-self: flex-start;
}

.export-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.export-notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.export-notes p {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
