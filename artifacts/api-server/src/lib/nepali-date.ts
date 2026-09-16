import NepaliDate from "nepali-date-converter";

const BS_DATE_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[0-2])$/;

export function formatBsDate(date: Date): string {
  return new NepaliDate(date).format("YYYY-MM-DD");
}

export function parseBsDate(value: string): { dateAd: string; dateBs: string } {
  if (!BS_DATE_PATTERN.test(value)) {
    throw new Error("Date must use YYYY-MM-DD BS format.");
  }

  const nepaliDate = new NepaliDate(value);
  const ad = nepaliDate.getAD();
  const dateAd = `${ad.year.toString().padStart(4, "0")}-${(ad.month + 1)
    .toString()
    .padStart(2, "0")}-${ad.date.toString().padStart(2, "0")}`;

  if (formatBsDate(new Date(`${dateAd}T00:00:00.000Z`)) !== value) {
    throw new Error("Date is not a valid Bikram Sambat calendar date.");
  }

  return { dateAd, dateBs: value };
}

export function todayBsDate(): string {
  return formatBsDate(new Date());
}
