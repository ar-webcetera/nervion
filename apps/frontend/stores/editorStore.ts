export const useEditorStore = defineStore('editor', () => {
  const isEditable = ref(false);

  return {
    isEditable,
  };
});
