import type { InjectionKey } from 'vue';
import type { WikiTreeNode } from '~/types/wiki';

export interface WikiDndContext {
  draggingId: Ref<number | null>;
  dropTarget: Ref<{ id: number; zone: 'before' | 'into' | 'after' } | null>;
  expandTargetId: Ref<number | null>;
  initDrag: (e: PointerEvent, pageId: number, itemEl: HTMLElement) => void;
}

export const WikiDndKey: InjectionKey<WikiDndContext> = Symbol('WikiDnd');

export const createWikiDnd = (): WikiDndContext => {
  const wikiStore = useWikiStore();

  const draggingId = ref<number | null>(null);
  const dropTarget = ref<{ id: number; zone: 'before' | 'into' | 'after' } | null>(null);
  const expandTargetId = ref<number | null>(null);

  let ghost: HTMLElement | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let scrollEl: HTMLElement | null = null;
  let rafId: number | null = null;
  let expandTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: { id: number; x0: number; y0: number; el: HTMLElement } | null = null;


  const find = (nodes: WikiTreeNode[], id: number): WikiTreeNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = find(n.children, id);
      if (f) return f;
    }
    return null;
  };

  /** Returns true if candidateId is a descendant of ancestorId */
  const isDescendant = (ancestorId: number, candidateId: number): boolean => {
    const a = find(wikiStore.wikiTree, ancestorId);
    return a ? !!find(a.children, candidateId) : false;
  };

  /** Remove node by id from the tree, return it */
  const excise = (nodes: WikiTreeNode[], id: number): WikiTreeNode | null => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes.splice(i, 1)[0];
      const r = excise(nodes[i].children, id);
      if (r) return r;
    }
    return null;
  };

  /**
   * Insert node relative to targetId.
   * pid — parent_page_id of the current level (null = root).
   */
  const place = (
    nodes: WikiTreeNode[],
    node: WikiTreeNode,
    targetId: number,
    zone: 'before' | 'into' | 'after',
    pid: number | null = null,
  ): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      const cur = nodes[i];
      if (cur.id === targetId) {
        if (zone === 'before') {
          const prev = i > 0 ? nodes[i - 1].priority : cur.priority - 200;
          node.priority = (prev + cur.priority) / 2;
          node.parent_page_id = pid;
          nodes.splice(i, 0, node);
          return true;
        }
        if (zone === 'after') {
          const next = i + 1 < nodes.length ? nodes[i + 1].priority : cur.priority + 200;
          node.priority = (cur.priority + next) / 2;
          node.parent_page_id = pid;
          nodes.splice(i + 1, 0, node);
          return true;
        }
        node.priority = cur.children.length > 0 ? Math.max(...cur.children.map((c) => c.priority)) + 100 : 1000;
        node.parent_page_id = cur.id;
        cur.children.push(node);
        return true;
      }
      if (place(cur.children, node, targetId, zone, cur.id)) return true;
    }
    return false;
  };


  const spawnGhost = (itemEl: HTMLElement, e: PointerEvent) => {
    const lbl = itemEl.querySelector<HTMLElement>('.wiki-menu-item__label') ?? itemEl;
    const r = lbl.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;

    ghost = lbl.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll('[data-handle]').forEach((h) => h.remove());
    Object.assign(ghost.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '9999',
      width: r.width + 'px',
      height: r.height + 'px',
      left: e.clientX - offsetX + 'px',
      top: e.clientY - offsetY + 'px',
      borderRadius: '6px',
      background: 'var(--dark-text-background-primary)',
      border: '1px solid var(--primary)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
      opacity: '0.9',
      transform: 'scale(1.02)',
      transition: 'none',
      willChange: 'left, top',
    });
    document.body.appendChild(ghost);
  };


  const findScrollParent = (el: HTMLElement): HTMLElement | null => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ov = getComputedStyle(p).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return null;
  };


  const onMove = (e: PointerEvent) => {
    if (pending) {
      if (Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) < 4) return;
      const { id, el } = pending;
      pending = null;
      draggingId.value = id;
      spawnGhost(el, e);
      document.body.style.userSelect = 'none';
      scrollEl = findScrollParent(el);
    }

    if (!draggingId.value || !ghost) return;

    ghost.style.left = e.clientX - offsetX + 'px';
    ghost.style.top = e.clientY - offsetY + 'px';

    if (scrollEl) {
      if (rafId) cancelAnimationFrame(rafId);
      const y = e.clientY;
      rafId = requestAnimationFrame(() => {
        if (!scrollEl) return;
        const r = scrollEl.getBoundingClientRect();
        const ZONE = 48,
          SPD = 7;
        if (y < r.top + ZONE) scrollEl.scrollTop -= SPD;
        else if (y > r.bottom - ZONE) scrollEl.scrollTop += SPD;
      });
    }

    ghost.style.display = 'none';
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    ghost.style.display = '';

    const itemEl = hit?.closest<HTMLElement>('[data-page-id]');
    if (!itemEl) {
      dropTarget.value = null;
      killExpand();
      return;
    }

    const tid = Number(itemEl.getAttribute('data-page-id'));

    if (tid === draggingId.value || isDescendant(draggingId.value, tid)) {
      dropTarget.value = null;
      killExpand();
      return;
    }

    const lblEl = itemEl.querySelector<HTMLElement>('.wiki-menu-item__label') ?? itemEl;
    const r = lblEl.getBoundingClientRect();
    const relY = (e.clientY - r.top) / r.height;
    const zone: 'before' | 'into' | 'after' = relY < 0.28 ? 'before' : relY > 0.72 ? 'after' : 'into';

    if (zone === 'into' && dropTarget.value?.id !== tid) scheduleExpand(tid);
    else if (zone !== 'into') killExpand();

    dropTarget.value = { id: tid, zone };
  };

  const onUp = async (_e: PointerEvent) => {
    if (pending) {
      pending = null;
      reset();
      return;
    }

    const fromId = draggingId.value;
    const tgt = dropTarget.value;
    reset();
    if (!fromId || !tgt) return;

    const node = excise(wikiStore.wikiTree, fromId);
    if (!node) return;
    place(wikiStore.wikiTree, node, tgt.id, tgt.zone);

    try {
      await wikiStore.updatePage(fromId, {
        parent_page_id: node.parent_page_id,
        priority: node.priority,
      });
    } catch {
      const pid = wikiStore.selectedProjectId;
      if (pid) void wikiStore.fetchPages(pid);
    }
  };


  const scheduleExpand = (id: number) => {
    killExpand();
    expandTimer = setTimeout(() => {
      expandTargetId.value = id;
    }, 650);
  };

  const killExpand = () => {
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    expandTargetId.value = null;
  };


  const reset = () => {
    draggingId.value = null;
    dropTarget.value = null;
    pending = null;
    ghost?.remove();
    ghost = null;
    document.body.style.userSelect = '';
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    killExpand();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    scrollEl = null;
  };


  const initDrag = (e: PointerEvent, pageId: number, itemEl: HTMLElement) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pending = { id: pageId, x0: e.clientX, y0: e.clientY, el: itemEl };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return { draggingId, dropTarget, expandTargetId, initDrag };
};
