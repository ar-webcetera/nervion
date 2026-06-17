import { computePosition, flip, shift } from '@floating-ui/dom';
import { posToDOMRect, VueRenderer } from '@tiptap/vue-3';
import type { Editor } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import EmojiList from '~/components/TipTap/EmojiList.vue';

const updatePosition = (editor: Editor, element: HTMLElement): void => {
  const virtualElement = {
    getBoundingClientRect: () => posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
  };

  computePosition(virtualElement, element, {
    placement: 'top-start',
    strategy: 'absolute',
    middleware: [shift(), flip()],
  }).then(({ x, y, strategy }) => {
    element.style.width = 'max-content';
    element.style.position = strategy;
    element.style.left = `${x - 16}px`;
    element.style.top = `${y - 4}px`;
  });
};

export default {
  items: ({ editor, query }: { editor: Editor; query: string }) => {
    return editor.storage.emoji.emojis
      .filter(({ name, shortcodes }: { name: string; shortcodes: string[] }) => {
        const q = query.toLowerCase();
        return name.startsWith(q) || shortcodes.some((s: string) => s.startsWith(q));
      })
      .slice(0, 10);
  },

  render: () => {
    let component: VueRenderer | null = null;

    return {
      onStart: (props: SuggestionProps) => {
        component = new VueRenderer(EmojiList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) return;

        const el = component.element as HTMLElement;
        const editorEl = props.editor.options.element as HTMLElement;
        editorEl.appendChild(el);
        updatePosition(props.editor, el);
      },

      onUpdate(props: SuggestionProps) {
        if (!component) return;
        component.updateProps(props);

        if (!props.clientRect) return;

        const el = component.element as HTMLElement;
        updatePosition(props.editor, el);
      },

      onKeyDown(props: SuggestionKeyDownProps & { event: KeyboardEvent }): boolean {
        if (props.event.key === 'Escape') {
          component?.destroy();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },

      onExit(): void {
        if (component) {
          const el = component.element as HTMLElement;
          el.remove();
          component.destroy();
        }
      },
    };
  },
};
