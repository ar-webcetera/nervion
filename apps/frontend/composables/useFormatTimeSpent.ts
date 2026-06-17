export const useFormatTimeSpent = (time_spent: number) => {
  const hours = Math.floor(time_spent / 3600);
  const minutes = Math.floor((time_spent % 3600) / 60);
  const seconds = time_spent % 60;
  return [hours.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), seconds.toString().padStart(2, '0')].join(':');
};
