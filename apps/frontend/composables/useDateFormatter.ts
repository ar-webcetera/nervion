const MSK = 'Europe/Moscow';
const DAY_MS = 86_400_000;

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: MSK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
});

export const useDateFormatter = () => {
  const formatMessageDate = (dateString: string | Date): string => {
    const date = new Date(dateString);
    const now = new Date();

    const dayKey = dayKeyFmt.format(date);
    const todayKey = dayKeyFmt.format(now);
    const yesterdayKey = dayKeyFmt.format(new Date(now.getTime() - DAY_MS));

    if (dayKey === todayKey) {
      return timeFmt.format(date);
    }

    if (dayKey === yesterdayKey) {
      return `Вчера ${timeFmt.format(date)}`;
    }

    return `${dateFmt.format(date)} ${timeFmt.format(date)}`;
  };

  return {
    formatMessageDate,
  };
};
