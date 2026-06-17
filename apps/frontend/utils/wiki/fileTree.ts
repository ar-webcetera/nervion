import type { File as S3File } from '~/types/file';

export interface FileTreeFile {
  type: 'file';
  name: string;
  key: string;
  size?: number;
  extension: string;
  s3File: S3File;
}

export interface FileTreeFolder {
  type: 'folder';
  name: string;
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeFile | FileTreeFolder;

export type FileExtensionType = 'image' | 'video' | 'markdown' | 'other';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

export const getExtensionType = (ext: string): FileExtensionType => {
  const lower = ext.toLowerCase();
  if (IMAGE_EXTENSIONS.has(lower)) return 'image';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  if (MARKDOWN_EXTENSIONS.has(lower)) return 'markdown';
  return 'other';
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
  [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });

const sortRecursive = (nodes: FileTreeNode[]): FileTreeNode[] =>
  sortNodes(nodes).map((node) => {
    if (node.type === 'folder') {
      return { ...node, children: sortRecursive(node.children) };
    }
    return node;
  });

export const buildFileTree = (files: S3File[], prefix: string): FileTreeNode[] => {
  const root: FileTreeFolder = { type: 'folder', name: '', children: [] };

  for (const file of files) {
    if (!file.Key.startsWith(prefix)) continue;
    const relativePath = file.Key.slice(prefix.length);
    if (!relativePath) continue;

    const parts = relativePath
      .split('/')
      .filter(Boolean)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    if (parts.length === 0) continue;

    const isFolder = file.Key.endsWith('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast && !isFolder) {
        const ext = part.includes('.') ? (part.split('.').pop() ?? '') : '';
        current.children.push({
          type: 'file',
          name: part,
          key: file.Key,
          size: file.Size,
          extension: ext,
          s3File: file,
        });
      } else {
        let folder = current.children.find((n): n is FileTreeFolder => n.type === 'folder' && n.name === part);
        if (!folder) {
          folder = { type: 'folder', name: part, children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  return sortRecursive(root.children);
};

export const navigateToPath = (tree: FileTreeNode[], pathSegments: string[]): FileTreeNode[] => {
  let nodes = tree;
  for (const segment of pathSegments) {
    const folder = nodes.find((n): n is FileTreeFolder => n.type === 'folder' && n.name === segment);
    if (!folder) return [];
    nodes = folder.children;
  }
  return nodes;
};
