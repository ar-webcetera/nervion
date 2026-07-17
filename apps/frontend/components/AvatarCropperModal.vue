<script setup lang="ts">
import { buildAwsObjectUrl } from '~/utils/resolveUrl';
import type { User } from '~/types/user';

const emit = defineEmits<{ saved: [url: string] }>();

const filesStore = useFilesStore();
const userStore = useUserStore();
const config = useRuntimeConfig();

const CANVAS_SIZE = 320;

const isOpen = ref(false);
const isUploading = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const img = ref<HTMLImageElement | null>(null);
const offsetX = ref(0);
const offsetY = ref(0);
const scale = ref(1);

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pinching = false;
let pinchStartDistance = 0;
let pinchStartScale = 1;

const open = () => {
  isOpen.value = true;
  nextTick(() => fileInputRef.value?.click());
};

const close = () => {
  isOpen.value = false;
  img.value = null;
};

defineExpose({ open });

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) {
    close();
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const image = new Image();
    image.onload = () => {
      img.value = image;
      const s = Math.max(CANVAS_SIZE / image.naturalWidth, CANVAS_SIZE / image.naturalHeight);
      scale.value = s;
      offsetX.value = (CANVAS_SIZE - image.naturalWidth * s) / 2;
      offsetY.value = (CANVAS_SIZE - image.naturalHeight * s) / 2;
      nextTick(draw);
    };
    image.src = ev.target!.result as string;
  };
  reader.readAsDataURL(file);
};

const draw = () => {
  const canvas = canvasRef.value;
  if (!canvas || !img.value) return;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.drawImage(
    img.value,
    offsetX.value,
    offsetY.value,
    img.value.naturalWidth * scale.value,
    img.value.naturalHeight * scale.value,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 4, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill('evenodd');
  ctx.restore();
};

watch([offsetX, offsetY, scale, img], draw);

const clampOffset = (ox: number, oy: number) => {
  if (!img.value) return { ox, oy };
  const w = img.value.naturalWidth * scale.value;
  const h = img.value.naturalHeight * scale.value;
  return {
    ox: Math.min(0, Math.max(CANVAS_SIZE - w, ox)),
    oy: Math.min(0, Math.max(CANVAS_SIZE - h, oy)),
  };
};

const getMinScale = () => {
  return Math.max(CANVAS_SIZE / (img.value?.naturalWidth ?? 1), CANVAS_SIZE / (img.value?.naturalHeight ?? 1));
};

const getTouchDistance = (touches: TouchList) => {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
};

const onMouseDown = (e: MouseEvent) => {
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOffsetX = offsetX.value;
  dragOffsetY = offsetY.value;
};

const onMouseMove = (e: MouseEvent) => {
  if (!dragging) return;
  const { ox, oy } = clampOffset(dragOffsetX + e.clientX - dragStartX, dragOffsetY + e.clientY - dragStartY);
  offsetX.value = ox;
  offsetY.value = oy;
};

const onMouseUp = () => {
  dragging = false;
};

const onTouchStart = (e: TouchEvent) => {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    pinching = false;
    dragging = true;
    dragStartX = touch.clientX;
    dragStartY = touch.clientY;
    dragOffsetX = offsetX.value;
    dragOffsetY = offsetY.value;
    return;
  }

  if (e.touches.length === 2) {
    dragging = false;
    pinching = true;
    pinchStartDistance = getTouchDistance(e.touches);
    pinchStartScale = scale.value;
  }
};

const onTouchMove = (e: TouchEvent) => {
  if (pinching && e.touches.length === 2) {
    const distance = getTouchDistance(e.touches);
    if (pinchStartDistance > 0) {
      scale.value = Math.max(getMinScale(), pinchStartScale * (distance / pinchStartDistance));
      const { ox, oy } = clampOffset(offsetX.value, offsetY.value);
      offsetX.value = ox;
      offsetY.value = oy;
    }
    return;
  }

  if (!dragging || e.touches.length !== 1) return;
  const touch = e.touches[0];
  const { ox, oy } = clampOffset(dragOffsetX + touch.clientX - dragStartX, dragOffsetY + touch.clientY - dragStartY);
  offsetX.value = ox;
  offsetY.value = oy;
};

const onTouchEnd = (e: TouchEvent) => {
  if (e.touches.length === 0) {
    dragging = false;
    pinching = false;
    return;
  }

  if (pinching && e.touches.length === 1) {
    pinching = false;
    dragging = true;
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    dragOffsetX = offsetX.value;
    dragOffsetY = offsetY.value;
  }
};

const onWheel = (e: WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  scale.value = Math.max(getMinScale(), scale.value + delta);
  const { ox, oy } = clampOffset(offsetX.value, offsetY.value);
  offsetX.value = ox;
  offsetY.value = oy;
};

const save = async () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = CANVAS_SIZE;
  exportCanvas.height = CANVAS_SIZE;
  const ctx = exportCanvas.getContext('2d')!;
  ctx.drawImage(
    img.value!,
    offsetX.value,
    offsetY.value,
    img.value!.naturalWidth * scale.value,
    img.value!.naturalHeight * scale.value,
  );

  isUploading.value = true;
  try {
    await new Promise<void>((resolve, reject) => {
      exportCanvas.toBlob(
        async (blob) => {
          if (!blob) {
            reject(new Error('blob error'));
            return;
          }
          const formData = new FormData();
          formData.append('file', blob, `avatar_${Date.now()}.jpg`);
          formData.append('prefix', 'tracker-avatars/');

          const result = await filesStore.addFile(formData);
          const photoUrl = buildAwsObjectUrl(result.Key, config.public.AWS_ENDPOINT) ?? result.Key;

          await userStore.updateUser({ photo_url: photoUrl } as User, userStore.user!.id);
          if (userStore.user) userStore.user.photo_url = photoUrl;

          emit('saved', photoUrl);
          close();
          resolve();
        },
        'image/jpeg',
        0.92,
      );
    });
  } finally {
    isUploading.value = false;
  }
};
</script>

<template>
  <input ref="fileInputRef" type="file" name="avatar-file" accept="image/*" style="display: none" @change="onFileChange" />

  <div v-if="isOpen && img" class="avatar-cropper__overlay" @click.self="close">
    <div class="avatar-cropper">
      <div class="avatar-cropper__header">
        <span class="avatar-cropper__title">Выбрать фото профиля</span>
        <button class="avatar-cropper__close" type="button" @click="close">
          <IconClose />
        </button>
      </div>

      <div class="avatar-cropper__hint">Перетащите, чтобы выбрать область. Колесо мыши — масштаб.</div>

      <canvas
        ref="canvasRef"
        :width="CANVAS_SIZE"
        :height="CANVAS_SIZE"
        class="avatar-cropper__canvas"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @wheel.prevent="onWheel"
      />

      <div class="avatar-cropper__actions">
        <button class="button_default" type="button" @click="close">Отмена</button>
        <button class="button_primary" type="button" :disabled="isUploading" @click="save">
          {{ isUploading ? 'Сохранение...' : 'Сохранить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.avatar-cropper {
  @include flex(cn);
  gap: 16px;
  width: 400px;
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--light-text-backgroung-primary-5);
  background: var(--dark-text-background-primary);

  &__overlay {
    @include flex(center);
    position: fixed;
    inset: 0;
    z-index: 2100;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  &__header {
    @include flex(rn, a-center, between);
  }

  &__title {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
  }

  &__close {
    @include flex(center);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary-50);
    padding: 0;

    svg {
      width: 18px;
      height: 18px;
    }

    &:hover {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__hint {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    text-align: center;
  }

  &__canvas {
    display: block;
    width: 352px;
    height: 352px;
    border-radius: 8px;
    cursor: grab;
    touch-action: none;
    user-select: none;
    align-self: center;

    &:active {
      cursor: grabbing;
    }
  }

  &__actions {
    @include flex(rn, j-end);
    gap: 8px;

    button {
      min-width: 100px;
    }
  }
}
</style>
