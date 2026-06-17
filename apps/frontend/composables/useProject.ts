import type BaseModal from '~/components/BaseModal.vue';

export const useProject = () => {
  const membersModal = ref<InstanceType<typeof BaseModal> | null>(null);
  const deleteMemberModal = ref<InstanceType<typeof BaseModal> | null>(null);
  const memberId = ref<number | null>(null);

  const openDeleteMemberModal = (id: number) => {
    memberId.value = id;
    if (!deleteMemberModal.value) return;
    deleteMemberModal.value.open();
  };

  const closeDeleteMemberModal = () => {
    memberId.value = null;
    if (!deleteMemberModal.value) return;
    deleteMemberModal.value.close();
  };

  const openMembersModal = () => {
    if (!membersModal.value) return;
    membersModal.value.open();
  };

  const closeMembersModal = () => {
    if (!membersModal.value) return;
    membersModal.value.close();
  };

  return {
    membersModal,
    openMembersModal,
    closeMembersModal,
    memberId,
    deleteMemberModal,
    openDeleteMemberModal,
    closeDeleteMemberModal,
  };
};
