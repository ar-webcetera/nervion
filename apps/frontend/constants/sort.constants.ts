export enum TypeSort {
  ASC = 'ASC',
  DESC = 'DESC',
}

export const TYPE_SORT_LABELS: Record<TypeSort, string> = {
  [TypeSort.ASC]: 'сначала старые',
  [TypeSort.DESC]: 'сначала новые',
};
