import NepaliDate from "nepali-date-converter";

const NepaliDateConstructor = (NepaliDate as unknown as { default?: typeof NepaliDate }).default ?? NepaliDate;

// formatToParts avoids both the browser timezone and locale-specific date strings.
export function kathmanduNow(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    month: `${part("year")}-${part("month")}`,
    isSaturday: part("weekday") === "Sat",
    hour: Number(part("hour")),
  };
}

export function shouldShowSahakariReminder(
  time: ReturnType<typeof kathmanduNow>,
  hasTodayEntry: boolean,
  dismissedDate: string | null,
) {
  return !time.isSaturday && time.hour >= 13 && !hasTodayEntry && dismissedDate !== time.date;
}

export function monthDateRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function adToBs(adDate: string) {
  const [year, month, day] = adDate.split("-").map(Number);
  return new NepaliDateConstructor(new Date(year, month - 1, day)).format("YYYY-MM-DD");
}
