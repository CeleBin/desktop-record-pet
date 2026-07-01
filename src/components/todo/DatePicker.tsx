import { useEffect, useMemo, useState } from "react";

// ── Types ──

export interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date) => void;
  onClear: () => void;
}

// ── Constants ──

/** Chinese weekday labels starting from Monday. */
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

// ── Pure helpers ──

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calendar grid cell metadata.
 */
interface Cell {
  day: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
}

/**
 * Build a 6×7 calendar grid for the given month.
 *
 * Chinese convention: weeks start on Monday.
 */
function buildGrid(year: number, month: number): Cell[][] {
  const dim = daysInMonth(year, month);
  const dimPrev = daysInMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);

  // getDay returns 0=Sun … 6=Sat → convert to Monday-based: Mon=0 … Sun=6
  const firstDow = new Date(year, month, 1).getDay();
  const offset = firstDow === 0 ? 6 : firstDow - 1;

  const rows: Cell[][] = [];
  let row: Cell[] = [];

  const py = month === 0 ? year - 1 : year;
  const pm = month === 0 ? 11 : month - 1;

  for (let i = offset - 1; i >= 0; i--) {
    row.push({ day: dimPrev - i, month: pm, year: py, isCurrentMonth: false });
  }

  for (let d = 1; d <= dim; d++) {
    row.push({ day: d, month, year, isCurrentMonth: true });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }

  const ny = month === 11 ? year + 1 : year;
  const nm = month === 11 ? 0 : month + 1;
  let pad = 1;
  while (row.length < 7) {
    row.push({ day: pad, month: nm, year: ny, isCurrentMonth: false });
    pad++;
  }
  rows.push(row);

  return rows;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ── Component ──

/**
 * Compact dark-theme DatePicker for the todo overlay panel.
 *
 * Features:
 *  • Month navigation via left/right chevrons
 *  • 7-column grid with Chinese weekday headers
 *  • Today highlighted with a subtle ring
 *  • Selected date with emerald‑400 filled background
 *  • Dimmed days outside current month
 *  • "清除截止日期" clear button (visible only when a date is selected)
 *
 * Zero external dependencies – pure React + Tailwind.
 */
export function DatePicker({ value, onChange, onClear }: DatePickerProps) {
  // "Today" is captured once at mount so it doesn't shift during interaction
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) return new Date(value.getFullYear(), value.getMonth(), 1);
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  // Follow the selected value when it changes externally (e.g. switching tasks)
  const valueKey = value ? `${value.getFullYear()}-${value.getMonth()}` : null;
  useEffect(() => {
    if (value) {
      setCurrentMonth(new Date(value.getFullYear(), value.getMonth(), 1));
    }
  }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  /** 切换到上一个月。JS Date 的月份会自动进位/退位（如 0→-1 变成前一年的 11 月）。 */
  const goPrev = () => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  /** 切换到下一个月。 */
  const goNext = () => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1));

  return (
    <div className="w-[276px] rounded-xl border border-border bg-surface/80 p-3 shadow-lg shadow-black/30">
      {/* ── Month / Year header ── */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted
            transition hover:bg-white/10 hover:text-text"
          aria-label="上月"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="select-none text-sm font-medium tabular-nums text-text">
          {year} 年 {month + 1} 月
        </span>

        <button
          type="button"
          onClick={goNext}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted
            transition hover:bg-white/10 hover:text-text"
          aria-label="下月"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* ── Weekday headers ── */}
      <div className="mb-0.5 grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-text0"
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      {grid.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell, ci) => {
            const date = new Date(cell.year, cell.month, cell.day);
            const selected = value !== null && sameDay(date, value);
            const todayMatch = sameDay(date, today);

            return (
              <button
                key={ci}
                type="button"
                onClick={() => onChange(date)}
                className={[
                  "flex h-8 w-9 items-center justify-center rounded-lg text-xs transition-colors duration-100",
                  cell.isCurrentMonth ? "text-text" : "text-text-muted",
                  selected
                    ? "bg-secondary font-semibold text-primary-fg"
                    : "hover:bg-white/10 hover:text-text",
                  todayMatch && !selected ? "ring-1 ring-inset ring-secondary/50" : "",
                ].join(" ")}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      ))}

      {/* ── Clear date button ── */}
      {value !== null && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5
            text-[11px] text-text-muted transition hover:bg-white/[5%] hover:text-text"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          清除截止日期
        </button>
      )}
    </div>
  );
}
