import type BaseModal from '~/components/BaseModal.vue';
import type { User } from '~/types/user';

export const useProfile = () => {
  const userStore = useUserStore();
  const { user } = storeToRefs(userStore);
  const isPopupOpen = ref(false);
  const userEditModal = ref<InstanceType<typeof BaseModal> | null>(null);
  const authStore = useAuthStore();

  const openPopup = () => {
    isPopupOpen.value = true;
  };

  const closePopup = () => {
    isPopupOpen.value = false;
  };

  const openUserEditModal = () => {
    if (!userEditModal.value) return;
    userEditModal.value.open();
  };

  const closeUserEditModal = () => {
    if (!userEditModal.value) return;
    userEditModal.value.close();
  };

  const getUserInfo = computed((): User | null => user.value);

  const handleLogout = async () => {
    try {
      await authStore.logout();
      location.replace('/login');
    } catch (e) {
      console.error(e);
    }
  };

  return {
    getUserInfo,
    isPopupOpen,
    openPopup,
    closePopup,
    openUserEditModal,
    closeUserEditModal,
    userEditModal,
    handleLogout,
  };
};
