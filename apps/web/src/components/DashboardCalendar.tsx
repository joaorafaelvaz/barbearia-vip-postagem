import { utcToLocal } from "@fsp/core";
import Link from "next/link";
import { calendarCells, type MonthRange } from "@/lib/dashboard";
import { STATUS_LABELS } from "@/lib/format";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface CalendarItem {
  id: string;
  postId: string;
  status: string;
  scheduledAt: Date;
  unitName: string;
  timezone: string;
}

export function DashboardCalendar({ range, items, todayKey }: { range: MonthRange; items: CalendarItem[]; todayKey: string }) {
  const byDay = new Map<string, CalendarItem[]>();
  for (const t of items) {
    const day = utcToLocal(t.scheduledAt, t.timezone).slice(0, 10);
    if (day.startsWith(range.key)) byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  return (
    <div className="stack">
      <div className="calendar" role="grid" aria-label={`Calendário de ${range.label}`}>
        {WEEKDAYS.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {calendarCells(range).map((day, i) => {
          const list = day ? byDay.get(day) ?? [] : [];
          const isToday = day === todayKey;
          return (
            <div key={i} className={`day ${day ? "" : "other"} ${isToday ? "today" : ""}`} role="gridcell">
              {day && <span className="n" aria-label={isToday ? `Hoje, dia ${Number(day.slice(-2))}` : undefined}>{Number(day.slice(-2))}</span>}
              {list.slice(0, 3).map((t) => (
                <Link key={t.id} className={`dot ${t.status}`} href={`/posts/${t.postId}`} title={`${t.unitName} · ${STATUS_LABELS[t.status]}`}>
                  {utcToLocal(t.scheduledAt, t.timezone).slice(11)} {t.unitName}
                </Link>
              ))}
              {list.length > 3 && <span className="more">+{list.length - 3}</span>}
            </div>
          );
        })}
      </div>
      <div className="legend" aria-hidden="true">
        <span><i style={{ background: "var(--info)" }} /> Agendado</span>
        <span><i style={{ background: "var(--warn)" }} /> Publicando</span>
        <span><i style={{ background: "var(--ok)" }} /> Publicado</span>
        <span><i style={{ background: "var(--err)" }} /> Falhou</span>
      </div>
    </div>
  );
}
