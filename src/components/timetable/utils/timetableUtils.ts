export const getMonday = (d: Date): Date => {
  const date = new Date(d.getTime());
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

export const getWeekRangeString = (monday: Date): string => {
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  };
  return `${formatDate(monday)} ~ ${formatDate(sunday)}`;
};

export const getWeekDates = (monday: Date): string[] => {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${r}`);
  }
  return dates;
};

export const getIsAfternoon = (timeSlot: string | null | undefined): boolean => {
  if (!timeSlot) return false;
  const match = timeSlot.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = parseInt(match[1], 10);
    return hour >= 12;
  }
  return false;
};
