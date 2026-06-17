export interface ITiptapContent {
  type: string;
  content: Array<{
    type: string;
    attrs?: {
      textAlign?: string;
    };
    content?: Array<{
      type: string;
      text: string;
    }>;
  }>;
}
