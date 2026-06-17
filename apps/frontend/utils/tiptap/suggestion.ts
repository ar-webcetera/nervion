import { computePosition, flip, shift } from '@floating-ui/dom';
import { posToDOMRect, VueRenderer } from '@tiptap/vue-3';

import type { SelectOption } from '~/types/select';
import type { Editor } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import MentionList from '~/components/TipTap/MentionList.vue';

type MentionSuggestionProps = SuggestionProps<SelectOption>;

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
  items: ({ query }: { query: string }) => {
    const userStore = useUserStore();
    return userStore.usersOptions.filter(
      (item) => item.first_name.toLowerCase().startsWith(query.toLowerCase()) && item.id !== userStore.user?.id,
    );
  },

  render: () => {
    let component: VueRenderer | null = null;

    return {
      onStart: (props: MentionSuggestionProps) => {
        component = new VueRenderer(MentionList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) {
          return;
        }

        const el = component.element as HTMLElement;
        const editorEl = props.editor.options.element as HTMLElement;
        editorEl.appendChild(el);
        updatePosition(props.editor, el);
      },

      onUpdate(props: MentionSuggestionProps) {
        if (!component) return;
        component?.updateProps(props);

        if (!props.clientRect) {
          return;
        }

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
