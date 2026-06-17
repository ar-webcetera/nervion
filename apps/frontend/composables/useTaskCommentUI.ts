import { TypeSort } from '~/constants/sort.constants';

export const useTaskCommentUI = (taskId: Ref<number | null>, fetchComments: () => Promise<void>) => {
  const commentStore = useCommentStore();
  const route = useRoute();

  const currentCommentId = computed<number | null>(() => {
    const commentId = route.query['comment-id'];
    if (!commentId) return null;
    const val = Array.isArray(commentId) ? commentId[0] : commentId;
    const commentNumber = Number(val);
    return Number.isInteger(commentNumber) ? commentNumber : null;
  });

  const currentSortType = computed<TypeSort>(() => {
    const sortType = commentStore.sortType;

    if (!sortType) {
      commentStore.setSortType();
      return TypeSort.ASC;
    }
    const val = Array.isArray(sortType) ? sortType[0] : sortType;
    const n = String(val) as TypeSort;
    return TypeSort[n];
  });

  const toggleSortType = () => {
    if (currentSortType.value === TypeSort.ASC) {
      commentStore.sortType = TypeSort.DESC;
      commentStore.setSortType(TypeSort.DESC);
    } else {
      commentStore.sortType = TypeSort.ASC;
      commentStore.setSortType();
    }
    fetchComments();
  };

  const scrollToComment = async (commentsContainer: HTMLElement | null, sidebarRef: HTMLElement | null) => {
    const id = currentCommentId.value;
    const root = commentsContainer;
    const scroller = sidebarRef;

    if (!id || !scroller || !root) {
      return;
    }

    const currentComment = commentStore.getCommentById(id);

    if (currentComment?.comment_id) {
      const thread = commentStore.getCommentById(currentComment.comment_id);
      if (thread) {
        thread.isOpenThread = true;
      }
      await nextTick();
      await nextTick();
    }

    await nextTick();

    const targetComment = root.querySelector<HTMLElement>(`[data-comment="${currentCommentId.value}"]`);

    if (!targetComment) {
      return;
    }

    targetComment.setAttribute('style', 'background-color: #4D48C3');

    const { smoothScrollToTarget } = await import('~/utils/scroll');
    smoothScrollToTarget(scroller, targetComment, 450);

    setTimeout(() => {
      targetComment.removeAttribute('style');
    }, 800);
  };

  return {
    currentCommentId,
    currentSortType,
    toggleSortType,
    scrollToComment,
  };
};
