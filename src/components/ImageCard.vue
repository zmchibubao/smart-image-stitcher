<script setup lang="ts">
import { computed } from 'vue'
import { useImageStore } from '../stores/imageStore'
import type { ImageItem } from '../types'

const props = defineProps<{
  image: ImageItem
  index: number
  total: number
}>()

const store = useImageStore()

const confidenceBadge = computed(() => {
  if (props.index === 0) return null
  const order = store.manualOrder
  const prevId = order[props.index - 1]
  if (!prevId) return null
  const match = store.getMatchBetween(prevId, props.image.id)
  if (!match) return null
  return match
})

const confidenceClass = computed(() => {
  const c = confidenceBadge.value?.confidence
  if (c === 'high') return 'badge-success'
  if (c === 'medium') return 'badge-warning'
  if (c === 'low') return 'badge-danger'
  return 'badge-muted'
})

const confidenceLabel = computed(() => {
  const m = confidenceBadge.value
  if (!m) return ''
  const pct = Math.round(m.score * 100)
  return `${pct}%`
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function remove() {
  store.removeImage(props.image.id)
}

function toggleLock() {
  if (props.image.locked) store.unlockImage(props.image.id)
  else store.lockImage(props.image.id)
}

function moveUp() {
  if (props.index > 0) {
    const order = [...store.manualOrder]
    const idx = order.indexOf(props.image.id)
    if (idx > 0) {
      ;[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
      store.setManualOrder(order)
    }
  }
}

function moveDown() {
  if (props.index < props.total - 1) {
    const order = [...store.manualOrder]
    const idx = order.indexOf(props.image.id)
    if (idx < order.length - 1) {
      ;[order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]
      store.setManualOrder(order)
    }
  }
}
</script>

<template>
  <div class="image-card card" :class="{ locked: image.locked, duplicate: image.isDuplicate }">
    <!-- Confidence connector (above card) -->
    <div v-if="confidenceBadge && index > 0" class="connector">
      <div class="connector-line"></div>
      <span class="badge" :class="confidenceClass">
        {{ confidenceLabel }}
      </span>
      <div class="connector-line"></div>
    </div>

    <!-- Order badge -->
    <div class="order-badge">{{ index + 1 }}</div>

    <!-- Duplicate badge -->
    <div v-if="image.isDuplicate" class="dup-badge badge badge-warning">重复</div>

    <!-- Lock badge -->
    <button class="lock-btn btn btn-icon" @click.stop="toggleLock" :title="image.locked ? '取消锁定' : '锁定位置'">
      {{ image.locked ? '🔒' : '🔓' }}
    </button>

    <!-- Thumbnail -->
    <div class="thumb-wrap">
      <img :src="image.dataUrl" :alt="image.name" class="thumb" />
    </div>

    <!-- Info -->
    <div class="card-info">
      <p class="file-name" :title="image.name">{{ image.name }}</p>
      <p class="file-meta">{{ image.width }}×{{ image.height }} · {{ formatSize(image.size) }}</p>
    </div>

    <!-- Actions -->
    <div class="card-actions">
      <button class="btn btn-icon btn-secondary" @click="moveUp" :disabled="index === 0" title="上移">↑</button>
      <button class="btn btn-icon btn-secondary" @click="moveDown" :disabled="index === total - 1" title="下移">↓</button>
      <button class="btn btn-icon btn-danger" @click="remove" title="删除">✕</button>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  transition: all var(--transition);
  cursor: grab;
}

.image-card:active {
  cursor: grabbing;
}

.image-card.locked {
  border-color: var(--warning);
  box-shadow: 0 0 0 2px rgba(245,158,11,0.2);
}

.image-card.duplicate {
  opacity: 0.6;
}

.connector {
  position: absolute;
  top: -24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  z-index: 1;
}

.connector-line {
  width: 1px;
  height: 8px;
  background: var(--border);
}

.order-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 22px;
  height: 22px;
  background: var(--primary);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  z-index: 2;
}

.dup-badge {
  position: absolute;
  top: 8px;
  right: 36px;
  font-size: 10px;
  z-index: 2;
}

.lock-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
  padding: 4px;
  z-index: 2;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
}

.thumb-wrap {
  width: 100%;
  aspect-ratio: 4/3;
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 10px;
  color: var(--text-muted);
}

.card-actions {
  display: flex;
  gap: 4px;
  margin-top: auto;
}

.card-actions .btn {
  flex: 1;
  justify-content: center;
  font-size: 12px;
}
</style>
