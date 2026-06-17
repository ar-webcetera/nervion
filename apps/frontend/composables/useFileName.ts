export const useFileName = () => {
  const getFileNameWithExtension = (path: string) => {
    const parts = path.split('/');
    if (parts.length) {
      const fileNameParts = parts.pop()?.split('.') || [];
      if (!fileNameParts.length) return '';
      const fileName = fileNameParts[0];
      const extension = fileNameParts[1];
      return `${fileName}.${extension}`;
    }
  };

  const getFileExt = (path: string) => {
    const cleanPath = path.split('?')[0];
    const parts = cleanPath.split('/');
    const fileName = parts[parts.length - 1] || '';
    const extParts = fileName.split('.');
    if (extParts.length < 2) return '';
    return extParts[extParts.length - 1].toLowerCase();
  };

  return {
    getFileNameWithExtension,
    getFileExt,
  };
};
