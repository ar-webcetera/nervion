export interface Mark {
  type: string;
  attrs?: LinkMarkAttrs;
}

export interface LinkMarkAttrs {
  href?: string;
}

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface ContentNode {
  type: string;
  attrs?: Record<string, any>;
  content?: Node[];
}

export type Node = ContentNode | TextNode;

const isTextNode = (node: Node): node is TextNode => {
  return node.type === 'text';
};

const isContentNode = (node: Node): node is ContentNode => {
  return node.type !== 'text';
};

export const extractTextFromDoc = (doc: { content?: Node[] } | Node, listCounter: number = 0): string => {
  let resultText = '';
  const nodes = (doc as { content: Node[] }).content || [];
  let currentItemIndex = listCounter;

  nodes.forEach((node: Node) => {
    if (isTextNode(node)) {
      let text = node.text;

      if (node.marks && node.marks.length > 0) {
        const linkMark = node.marks.find((mark) => mark.type === 'link');

        if (linkMark && linkMark.attrs && linkMark.attrs.href) {
          const url = linkMark.attrs.href;
          text = `${text} (${url})`;
        }
      }

      resultText += text + ' ';
    }

    if (isContentNode(node)) {
      if (node.type === 'listItem') {
        const parentType = (doc as ContentNode).type;
        if (parentType === 'orderedList') {
          currentItemIndex++;
          resultText += `${currentItemIndex}. `;
        } else if (parentType === 'bulletList') {
          resultText += '* ';
        }
      }

      if (node.type === 'taskItem') {
        const checked = node.attrs?.checked ? '[X] ' : '[ ] ';
        resultText += checked;
      }

      if (node.type === 'table') {
        resultText += '\n---НАЧАЛО ТАБЛИЦЫ---\n';
      }

      if (node.content && node.content.length > 0) {
        resultText += extractTextFromDoc(node, currentItemIndex);
      }

      if (node.type === 'listItem' || node.type === 'taskItem' || node.type === 'tableRow') {
        resultText += '\n';
      }

      if (['paragraph', 'heading'].includes(node.type)) {
        resultText += '\n';
      }

      if (node.type === 'table') {
        resultText += '\n---КОНЕЦ ТАБЛИЦЫ---\n';
      }

      if (['tableCell', 'tableHeader'].includes(node.type)) {
        resultText += ' | ';
      }

      if (node.type === 'image' && node.attrs && node.attrs.src) {
        resultText += `[img]: ${node.attrs.src} \n`;
      }
    }
  });

  return resultText.trim();
};
