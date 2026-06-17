<script setup lang="ts">
defineOptions({ name: 'EmojiPicker' });

const emit = defineEmits<{
  (e: 'select', emoji: string): void;
}>();

const categories: { label: string; emojis: string[] }[] = [
  {
    label: 'Смайлы',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐'],
  },
  {
    label: 'Жесты',
    emojis: ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👋','🤚','🖐️','✋','🖖','💪','🦾','🤜','🤛','👊','✊','🙌','👐','🤲','🙏','🤝','✍️','💅','🦵','🦶','👂','👃'],
  },
  {
    label: 'Люди',
    emojis: ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','👷','🤴','👸','👲','🧕','🤵','👰','🤰','🤱','🧑‍🍼','👼','🎅','🤶','🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚'],
  },
  {
    label: 'Животные',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🦂','🐢','🐍','🦎','🐊','🐙','🦑','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'],
  },
  {
    label: 'Еда',
    emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🌮','🌯','🥗','🥘','🍜','🍝','🍣','🍱','🍛','🍲','🥣','🍤','🍙','🍚','🍘','🍥','🥮','🍡','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','☕','🍵','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉'],
  },
  {
    label: 'Активность',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏏','🪃','⛳','🪁','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🪀','🪆','🎮','🕹️','🎲','♟️','🎭','🎨','🖼️','🎰','🚂','🚗','✈️','🚀','🛸'],
  },
  {
    label: 'Символы',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚡','🔥','💫','⭐','🌟','✨','🎉','🎊','🎈','🎁','🏆','🥇','🥈','🥉','🎖️','🏅','🎗️','🎀','🎫','🎟️','🎪','✅','❌','❎','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪'],
  },
];

const activeCategory = ref(0);

const filteredEmojis = computed(() => categories[activeCategory.value]?.emojis ?? []);
</script>

<template>
  <div class="emoji-picker">
    <div class="emoji-picker__categories">
      <button
        v-for="(cat, i) in categories"
        :key="cat.label"
        :class="['emoji-picker__cat-btn', { 'emoji-picker__cat-btn_active': activeCategory === i }]"
        :title="cat.label"
        @click="activeCategory = i"
      >
        {{ cat.emojis[0] }}
      </button>
    </div>
    <div class="emoji-picker__grid">
      <button
        v-for="emoji in filteredEmojis"
        :key="emoji"
        class="emoji-picker__emoji"
        :title="emoji"
        @click="emit('select', emoji)"
      >
        {{ emoji }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.emoji-picker {
  width: 288px;

  @media (max-width: $screen-mobile-l) {
    width: 100%;
  }
  background: var(--dark-text-background-primary);
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 10px;
  box-shadow: 0 8px 32px var(--black-40);
  overflow: hidden;
  @include flex(cn);

  &__categories {
    @include flex(rn, a-center);
    padding: 4px 8px;
    gap: 2px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__cat-btn {
    width: 30px;
    height: 30px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    @include flex(center);
    flex-shrink: 0;
    transition: background 0.1s ease;
    opacity: 0.6;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      opacity: 1;
    }

    &_active {
      background: var(--light-text-backgroung-primary-10);
      opacity: 1;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
    padding: 6px 8px 8px;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--light-text-backgroung-primary-10) transparent;
  }

  &__emoji {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 18px;
    @include flex(center);
    transition: background 0.1s ease;
    line-height: 1;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
  }
}
</style>
