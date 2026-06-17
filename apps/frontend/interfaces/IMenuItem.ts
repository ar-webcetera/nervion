import type { ITiptapContent } from '~/interfaces/ITiptapContent';

export interface IMenuItem {
  id: number | string;
  title: string;
  parent_id?: number | string;
  section_id?: number | string;

  sections?: IMenuItem[];
  chapters?: IMenuItem[];

  blocks?: {
    chapter_id: number | string;
    type: string;
    content: ITiptapContent[];
  };
}
