import type { File } from '~/types/file';

export const useFilesStore = defineStore('files', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const files = ref<File[]>([]);
  const isLoading = ref(false);
  const fetchFiles = async (prefix: string) => {
    isLoading.value = true;
    try {
      const params: { prefix: string } = { prefix: prefix };

      const data = await tenantFetch<File[]>('/api/files', {
        baseURL: tenantApiBaseUrl,
        credentials: 'include',
        params,
      });

      files.value = data;
      return data;
    } catch (e) {
      const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
      if (status !== 404) {
        console.error(e);
      }
      files.value = [];
      return [];
    } finally {
      isLoading.value = false;
    }
  };

  const addFile = async (formData: FormData) => {
    const file = await tenantFetch<File>('/api/files', {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: formData,
    });
    files.value.push(file);
    return file;
  };

  const getFileContent = async (key: string): Promise<string> => {
    return tenantFetch<string>('/api/files/content', {
      baseURL: tenantApiBaseUrl,
      credentials: 'include',
      params: { key },
    });
  };

  const saveFileContent = async (key: string, content: string): Promise<void> => {
    await tenantFetch('/api/files/content', {
      method: 'PUT',
      baseURL: tenantApiBaseUrl,
      credentials: 'include',
      params: { key },
      body: { content },
    });
  };

  const createFolder = async (prefix: string, folderName: string) => {
    await tenantFetch<{ key: string }>('/api/files/folder', {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: { prefix, folderName },
    });
  };

  const deleteFile = async (key: string) => {
    await tenantFetch('/api/files', {
      method: 'DELETE',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      params: { key },
    });
    files.value = files.value.filter((f) => f.Key !== key);
  };

  const deleteFolder = async (prefix: string) => {
    await tenantFetch('/api/files/folder', {
      method: 'DELETE',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      params: { prefix },
    });
    files.value = files.value.filter((f) => !f.Key.startsWith(prefix));
  };

  return {
    files,
    isLoading,
    fetchFiles,
    addFile,
    getFileContent,
    saveFileContent,
    createFolder,
    deleteFile,
    deleteFolder,
  };
});
