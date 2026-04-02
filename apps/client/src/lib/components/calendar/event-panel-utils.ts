export interface CalDay {
  day: number;
  dateStr: string;
  currentMonth: boolean;
  selected: boolean;
  today: boolean;
}

export function buildCalendarGrid(y: number, m: number, selectedStr: string): CalDay[] {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const firstDow = new Date(y, m - 1, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysInPrevMonth = new Date(y, m - 1, 0).getDate();
  const days: CalDay[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const ds = `${py}-${String(pm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ day: d, dateStr: ds, currentMonth: false, selected: ds === selectedStr, today: ds === todayStr });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ day: d, dateStr: ds, currentMonth: true, selected: ds === selectedStr, today: ds === todayStr });
  }
  const totalNeeded = Math.ceil(days.length / 7) * 7;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  for (let d = 1; days.length < totalNeeded; d++) {
    const ds = `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ day: d, dateStr: ds, currentMonth: false, selected: ds === selectedStr, today: ds === todayStr });
  }
  return days;
}

export const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function bounceIcon(e: MouseEvent): void {
  const btn = (e.currentTarget as HTMLElement).querySelector("svg");
  if (!btn) return;
  btn.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.2)" },
      { transform: "scale(1)" },
    ],
    { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}
