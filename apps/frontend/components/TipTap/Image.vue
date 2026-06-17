<script setup lang="ts">
import { ref, computed } from 'vue';
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/vue-3';
import BaseImageModal from '~/components/BaseImageModal.vue';
import { useResolveUrl } from '~/utils/resolveUrl';
import { IMAGE_UPLOAD_STATE_UPLOADING } from '~/utils/tiptap/imageUploadPlaceholder';

const props = defineProps<NodeViewProps>();
const minWidth = 10;
const maxWidth = 900;
const dragging = ref(false);
const startX = ref(0);
const startWidth = ref(0);

const { resolveAwsUrl } = useResolveUrl();

const imageModal = ref<InstanceType<typeof BaseImageModal> | null>(null);

const width = computed({
  get() {
    return Number(props.node.attrs.width);
  },
  set(value) {
    props.updateAttributes({
      width: Number(value),
    });
  },
});

const isUploading = computed(() => props.node.attrs.uploadState === IMAGE_UPLOAD_STATE_UPLOADING);
const rawImageSrc = computed(() => {
  const src = props.node.attrs.src;
  return typeof src === 'string' ? src : '';
});
const imageSrc = computed(() => {
  if (rawImageSrc.value.startsWith('blob:') || rawImageSrc.value.startsWith('data:')) return rawImageSrc.value;
  return resolveAwsUrl(rawImageSrc.value) || '';
});
const uploadName = computed(() => {
  const value = props.node.attrs.uploadName;
  return typeof value === 'string' && value.trim() ? value : 'Изображение';
});

const startResize = (event: MouseEvent) => {
  startX.value = event.clientX;
  startWidth.value = width.value;
  dragging.value = true;

  window.addEventListener('mousemove', resizeImage);
  window.addEventListener('mouseup', stopResize);
};

const stopResize = () => {
  dragging.value = false;
  window.removeEventListener('mousemove', resizeImage);
  window.removeEventListener('mouseup', stopResize);
};

const resizeImage = (event: MouseEvent) => {
  if (dragging.value) {
    const deltaX = event.clientX - startX.value;
    const newWidth = startWidth.value + deltaX;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      width.value = newWidth;
    }
  }
};

const openModal = () => {
  if (!imageModal.value) return;
  imageModal.value.open();
};

const handleImageClick = () => {
  if (isUploading.value) return;
  openModal();
};
</script>

<template>
  <NodeViewWrapper :class="['image__resize', { image__resize_uploading: isUploading }]" :draggable="!isUploading">
    <img
      :src="imageSrc"
      :style="{
        width: width / 10 + 'rem',
      }"
      @click.stop="handleImageClick"
    />
    <span v-if="isUploading" class="image__loader" :title="`Загрузка: ${uploadName}`" />
    <div v-if="props.editor.isEditable && !isUploading" class="image__side-move" @mousedown="startResize" />
  </NodeViewWrapper>
  <teleport to="#teleports">
    <BaseImageModal v-if="!props.editor.isEditable && !isUploading" ref="imageModal">
      <div class="image-modal">
        <img :src="imageSrc" alt="" />
      </div>
    </BaseImageModal>
  </teleport>
</template>

<style lang="scss" scoped>
.image-modal {
  border-radius: 16px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 16px;
  }

  @media (max-width: $screen-mobile-l) {
    width: 100%;
    height: fit-content;
  }
}

.image {
  &__text {
    flex: 1;
  }

  &__buttons {
    width: auto;
    margin: 20px auto;
    text-align: center;

    button {
      width: auto;
    }
  }

  &_left {
    justify-content: revert;
  }

  &_right {
    flex-direction: row-reverse;
  }

  &__side-move {
    position: absolute;
    width: 5px;
    height: 100%;
    right: -10px;
    top: 0;
    cursor: col-resize;

    &:after {
      content: '';
      display: block;
      position: absolute;
      height: 30%;
      width: 3px;
      background: var(--primary-dark);
      right: 5px;
      top: 35%;
      border-radius: 10px;
      opacity: 0.3;
      transition: all 0.3s;
    }

    &:hover {
      &:after {
        opacity: 1;
      }
    }
  }

  &__resize {
    max-width: 100%;
    position: relative;
    display: inline-flex;
    user-select: none;
    cursor: pointer;

    &:hover {
      .image__side-move {
        &:after {
          opacity: 0.6;
          height: 90%;
          top: 5%;
        }
      }
    }

    img {
      max-width: 100%;
      border-radius: 5px;
    }

    &_uploading {
      cursor: default;
      overflow: hidden;

      img {
        opacity: 0.72;
      }
    }
  }

  &__loader {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 34px;
    height: 34px;
    margin-top: -17px;
    margin-left: -17px;
    border-radius: 50%;
    border: 3px solid var(--light-text-backgroung-primary-50);
    border-top-color: var(--primary);
    background: var(--black-25);
    box-shadow: 0 0 0 999px var(--black-25);
    animation: image-upload-spin 0.8s linear infinite;
    pointer-events: none;
  }
}

@keyframes image-upload-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
