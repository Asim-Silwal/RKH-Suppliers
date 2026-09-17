import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (value: number) => String(value).padStart(2, "0");

function readDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function EnglishDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = readDate(value);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selected.getFullYear());
  const [month, setMonth] = useState(selected.getMonth());
  const root = useRef<HTMLDivElement>(null);
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array<null>(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const isSelected = (day: number) => selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const changeMonth = (direction: -1 | 1) => {
    const next = new Date(year, month + direction, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };
  const choose = (day: number) => {
    onChange(`${year}-${pad(month + 1)}-${pad(day)}`);
    setOpen(false);
  };
  const chooseToday = () => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    onChange(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
    setOpen(false);
  };

  return <div className="bs-date-picker" ref={root} onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
    <button type="button" className="bs-date-trigger" aria-label={`English date: ${selected.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}. Open calendar`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setYear(selected.getFullYear()); setMonth(selected.getMonth()); setOpen(!open); }}>
      <span>{selected.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span><CalendarDays size={18} aria-hidden="true" />
    </button>
    {open && <div className="bs-calendar" role="dialog" aria-label="Choose an English date">
      <div className="bs-calendar-heading">
        <button type="button" aria-label="Previous English month" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
        <div className="bs-calendar-selects"><select aria-label="English month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{months.map((name, index) => <option key={name} value={index}>{name}</option>)}</select><select aria-label="English year" value={year} onChange={(event) => setYear(Number(event.target.value))}>{Array.from({ length: 101 }, (_, index) => 2000 + index).map((item) => <option key={item}>{item}</option>)}</select></div>
        <button type="button" aria-label="Next English month" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="bs-calendar-grid">{weekdays.map((day) => <span className="bs-calendar-weekday" key={day}>{day}</span>)}{cells.map((day, index) => day === null ? <span key={`blank-${index}`} /> : <button type="button" key={day} className={isSelected(day) ? "selected" : ""} aria-pressed={isSelected(day)} onClick={() => choose(day)}>{day}</button>)}</div>
      <div className="bs-calendar-footer"><span>Gregorian calendar (AD)</span><button type="button" onClick={chooseToday}>Today</button></div>
    </div>}
  </div>;
}
