import { CellSelection } from '@tiptap/pm/tables';

export const isCellSelection = (value: object): value is CellSelection => {
  return value instanceof CellSelection;
};
