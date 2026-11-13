<script setup lang="ts">
import { computed, ref } from 'vue'
import { useImageStore } from '../stores/imageStore'
import ImageCard from './ImageCard.vue'
import type { ImageItem } from '../types'

const store = useImageStore()

const orderedImages = computed<ImageItem[]>(() => {
  const order = store.manualOrder.length > 0
    ? store.manualOrder
    : store.images.map(i => i.id)
  return order
    .map(id => store.images.find(img => img.id === id))
    .filter(Boolean) as ImageItem[]
})

// Drag-and-drop state
const dragItem = ref<string | null>(null)
const dragOver = ref<string | null>(null)

function onDragStart(id: string) {
  dragItem.value = id
}

function onDragEnter(id: string) {
  if (dragItem.value !== id) dragOver.value = id
}

function onDragEnd() {
  if (dragItem.value && dragOver.value && dragItem.value !== dragOver.value) {
    const order = [...store.manualOrder]
    const fromIdx = order.indexOf(dragItem.value)
    const toIdx = order.indexOf(dragOver.value)
    if (fromIdx !== -1 && toIdx !== -1) {
      order.splice(fromIdx, 1)
      order.splice(toIdx, 0, dragItem.value)
      store.setManualOrder(order)
    }
  }
  dragItem.value = null
  dragOver.value = null
}

function confirmRestoreAuto() {
  if (confirm('确认恢复算法推荐的排序？手动调整将会丢失。')) {
    store.restoreAutoOrder()
  }
}

function clearAll() {
  if (confirm('确认清空所有图片？')) {
    store.clearAll()
  }
}
</script>

<template>
  <div class="image-grid-wrap card">
    <!-- Toolbar -->
    <div class="grid-toolbar">
      <div class="toolbar-left">
        <span class="count-text">{{ store.images.length }} 张图片</span>
        <span v-if="store.stitchGroups.length > 1" class="badge badge-primary">
          {{ store.stitchGroups.length }} 个分组
        </span>
      </div>
      <div class="toolbar-right">
        <button
          v-if="store.autoOrder.length > 0"
          class="btn btn-secondary btn-sm"
          @click="confirmRestoreAuto"
          title="恢复算法推荐排序"
        >
          🔄 恢复自动排序
        </button>
        <button class="btn btn-danger btn-sm" @click="clearAll">
          🗑 清空
        </button>
      </div>
    </div>

    <!-- Grid -->
    <div class="image-grid">
      <div
        v-for="(img, idx) in orderedImages"
        :key="img.id"
        class="grid-item"
        :class="{ 'drag-over': dragOver === img.id, 'dragging': dragItem === img.id }"
        draggable="true"
        @dragstart="onDragStart(img.id)"
        @dragenter.prevent="onDragEnter(img.id)"
        @dragover.prevent
        @dragend="onDragEnd"
        @drop.prevent="onDragEnd"
      >
        <ImageCard :image="img" :index="idx" :total="orderedImages.length" />
      </div>
    </div>

    <!-- Hint -->
    <p class="grid-hint">💡 拖拽图片卡片可手动调整顺序 · 点击 🔒 可锁定位置</p>
  </div>
</template>

<style scoped>
.image-grid-wrap {
  padding: 16px;
}

.grid-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.count-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.grid-item {
  transition: all var(--transition);
}

.grid-item.drag-over {
  outline: 2px dashed var(--primary);
  border-radius: var(--radius);
}

.grid-item.dragging {
  opacity: 0.4;
}

.grid-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

@media (max-width: 480px) {
  .image-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}
</style>
