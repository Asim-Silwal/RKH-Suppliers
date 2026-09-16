import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import NepaliDate, { dateConfigMap } from "nepali-date-converter";

const months = [
  "Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Aswin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const years = Object.keys(dateConfigMap).map(Number).sort((a, b) => a - b);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function adFromBs(date: NepaliDate) {
  const ad = date.getAD();
  return `${ad.year}-${pad(ad.month + 1)}-${pad(ad.date)}`;
}

export function todayDates() {
  const today = new NepaliDate();
  return { bs: today.format("YYYY-MM-DD"), ad: adFromBs(today) };
}

export function NepaliDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (bs: string, ad: string) => void;
}) {
  const selected = new NepaliDate(value);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selected.getYear());
  const [month, setMonth] = useState(selected.getMonth());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const monthLength = dateConfigMap[year]?.[months[month]] ?? 0;
  const firstDay = new NepaliDate(year, month, 1).getDay();
  const cells = [
    ...Array<null>(firstDay).fill(null),
    ...Array.from({ length: monthLength }, (_, index) => index + 1),
  ];

  const changeMonth = (direction: -1 | 1) => {
    const next = year * 12 + month + direction;
    setYear(Math.floor(next / 12));
    setMonth(((next % 12) + 12) % 12);
  };

  const choose = (date: NepaliDate) => {
    onChange(date.format("YYYY-MM-DD"), adFromBs(date));
    setYear(date.getYear());
    setMonth(date.getMonth());
    setOpen(false);
  };

  return (
    <div className="bs-date-picker" ref={root} onKeyDown={(event) => {
      if (event.key === "Escape") setOpen(false);
    }}>
      <button
        type="button"
        className="bs-date-trigger"
        aria-label={`Nepali date: ${selected.format("DD MMMM YYYY")}. Open calendar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setYear(selected.getYear());
          setMonth(selected.getMonth());
          setOpen(!open);
        }}
      >
        <span>{selected.format("DD MMMM YYYY")}</span>
        <CalendarDays size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="bs-calendar" role="dialog" aria-label="Choose a Bikram Sambat date">
          <div className="bs-calendar-heading">
            <button type="button" aria-label="Previous Nepali month" onClick={() => changeMonth(-1)} disabled={year === years[0] && month === 0}>
              <ChevronLeft size={18} />
            </button>
            <div className="bs-calendar-selects">
              <select aria-label="Nepali month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                {months.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
              <select aria-label="Nepali year" value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {years.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <button type="button" aria-label="Next Nepali month" onClick={() => changeMonth(1)} disabled={year === years[years.length - 1] && month === 11}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="bs-calendar-grid">
            {weekdays.map((day) => <span className="bs-calendar-weekday" key={day}>{day}</span>)}
            {cells.map((day, index) => day === null
              ? <span key={`blank-${index}`} />
              : <button
                  type="button"
                  key={day}
                  className={selected.getYear() === year && selected.getMonth() === month && selected.getDate() === day ? "selected" : ""}
                  aria-label={`${day} ${months[month]} ${year} BS`}
                  aria-pressed={selected.getYear() === year && selected.getMonth() === month && selected.getDate() === day}
                  onClick={() => choose(new NepaliDate(year, month, day))}
                >{day}</button>
            )}
          </div>
          <div className="bs-calendar-footer">
            <span>Bikram Sambat (BS)</span>
            <button type="button" onClick={() => choose(new NepaliDate())}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
