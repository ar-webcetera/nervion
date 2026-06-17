import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from '@tiptap/core';
import { callOrReturn, getExtensionField, mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  addColumnAfter,
  addRowAfter,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  tableEditing,
  TableView,
} from '@tiptap/pm/tables';

import type { EditorView, NodeView } from '@tiptap/pm/view';

import { createColGroup } from './createColGroup';
import { createTable } from './createTable';
import { deleteTableWhenAllCellsSelected } from './deleteTableWhenAllCellsSelected';

export interface TableOptions {
  /**
   * HTML attributes for the table element.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, never>;

  /**
   * Enables the resizing of tables.
   * @default false
   * @example true
   */
  resizable: boolean;

  /**
   * The width of the resize handle.
   * @default 5
   * @example 10
   */
  handleWidth: number;

  /**
   * The minimum width of a cell.
   * @default 25
   * @example 50
   */
  cellMinWidth: number;

  /**
   * The node view to render the table.
   * @default TableView
   */
  View: (new (node: ProseMirrorNode, cellMinWidth: number, view: EditorView) => NodeView) | null;

  /**
   * Enables the resizing of the last column.
   * @default true
   * @example false
   */
  lastColumnResizable: boolean;

  /**
   * Allow table node selection.
   * @default false
   * @example true
   */
  allowTableNodeSelection: boolean;
}

export const Table = Node.create<TableOptions>({
  name: 'table',
  addOptions() {
    return {
      HTMLAttributes: {},
      resizable: false,
      handleWidth: 2,
      cellMinWidth: 1,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
      View: null,
    };
  },
  content: 'tableRow+',
  tableRole: 'table',
  isolating: true,
  group: 'block',
  parseHTML() {
    return [{ tag: 'table' }];
  },
  markdownTokenName: 'table',
  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers): JSONContent[] {
    if (token.type !== 'table') {
      return [];
    }

    const rows: JSONContent[] = [];

    const buildCellContent = (cell: MarkdownToken): JSONContent => {
      const cellTokens = (cell.tokens || []) as MarkdownToken[];
      const inline = cellTokens.length > 0 ? helpers.parseInline(cellTokens) : [];
      if (inline.length > 0) {
        return { type: 'paragraph', content: inline };
      }
      return { type: 'paragraph' };
    };

    const header = token.header as MarkdownToken[] | undefined;
    if (header && header.length > 0) {
      const headerCells: JSONContent[] = header.map((cell) => ({
        type: 'tableHeader',
        content: [buildCellContent(cell)],
      }));
      rows.push({ type: 'tableRow', content: headerCells });
    }

    const bodyRows = token.rows as MarkdownToken[][] | undefined;
    if (bodyRows && bodyRows.length > 0) {
      for (const row of bodyRows) {
        const bodyCells: JSONContent[] = row.map((cell) => ({
          type: 'tableCell',
          content: [buildCellContent(cell)],
        }));
        rows.push({ type: 'tableRow', content: bodyCells });
      }
    }

    if (rows.length === 0) {
      return [];
    }

    return [{ type: 'table', content: rows }];
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers): string {
    const rows = node.content ?? [];
    if (rows.length === 0) return '';

    const getCellText = (cell: JSONContent): string => {
      const content = cell.content ?? [];
      return content
        .map((child) => helpers.renderChildren(child.content ?? []))
        .join(' ')
        .trim()
        .replace(/\|/g, '\\|');
    };

    const [headerRow, ...bodyRows] = rows;
    const headerCells = (headerRow?.content ?? []).map(getCellText);

    const lines: string[] = [
      `| ${headerCells.join(' | ')} |`,
      `| ${headerCells.map(() => '---').join(' | ')} |`,
      ...bodyRows.map((row) => {
        const cells = (row.content ?? []).map(getCellText);
        return `| ${cells.join(' | ')} |`;
      }),
    ];

    return lines.join('\n') + '\n';
  },

  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);

    const table: DOMOutputSpec = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style: tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`,
      }),
      colgroup,
      ['tbody', 0],
    ];

    return table;
  },
  addCommands() {
    return {
      insertTable:
        ({ rows = 3, cols = 3, withHeaderRow = true } = {}) =>
        ({ tr, dispatch, editor }) => {
          const node = createTable(editor.schema, rows, cols, withHeaderRow);
          if (dispatch) {
            const offset = tr.selection.from + 1;

            tr.replaceSelectionWith(node)
              .scrollIntoView()
              .setSelection(TextSelection.near(tr.doc.resolve(offset)));
          }

          return true;
        },
      addColumnAfter:
        () =>
        ({ state, dispatch }) => {
          return addColumnAfter(state, dispatch);
        },
      deleteColumn:
        () =>
        ({ state, dispatch }) => {
          return deleteColumn(state, dispatch);
        },
      addRowAfter:
        () =>
        ({ state, dispatch }) => {
          return addRowAfter(state, dispatch);
        },
      deleteRow:
        () =>
        ({ state, dispatch }) => {
          return deleteRow(state, dispatch);
        },
      deleteTable:
        () =>
        ({ state, dispatch }) => {
          return deleteTable(state, dispatch);
        },

      goToNextCell:
        () =>
        ({ state, dispatch }) => {
          return goToNextCell(1)(state, dispatch);
        },
      goToPreviousCell:
        () =>
        ({ state, dispatch }) => {
          return goToNextCell(-1)(state, dispatch);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.commands.goToNextCell()) {
          return true;
        }

        if (!this.editor.can().addRowAfter()) {
          return false;
        }

        return this.editor.chain().addRowAfter().goToNextCell().run();
      },
      'Shift-Tab': () => this.editor.commands.goToPreviousCell(),
      Backspace: deleteTableWhenAllCellsSelected,
      'Mod-Backspace': deleteTableWhenAllCellsSelected,
      Delete: deleteTableWhenAllCellsSelected,
      'Mod-Delete': deleteTableWhenAllCellsSelected,
    };
  },

  addProseMirrorPlugins() {
    const isResizable = this.options.resizable;

    return [
      ...(isResizable
        ? [
            columnResizing({
              handleWidth: this.options.handleWidth,
              cellMinWidth: this.options.cellMinWidth,
              View: this.options.View ?? TableView,
              lastColumnResizable: this.options.lastColumnResizable,
            }),
          ]
        : []),
      tableEditing({
        allowTableNodeSelection: this.options.allowTableNodeSelection,
      }),
    ];
  },

  extendNodeSchema(extension) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
    };

    return {
      tableRole: callOrReturn(getExtensionField(extension, 'tableRole', context)),
    };
  },
});
