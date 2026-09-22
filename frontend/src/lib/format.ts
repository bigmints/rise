import type { Checkin, Tracker, TrackerEntry, WellnessEvent } from "@/types";

export const RESTED_LABELS = { yes: "Rested", somewhat: "Okay", no: "Tired" } as const;

export function asDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateKey(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : asDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDay(day: string, long = false) {
  return new Intl.DateTimeFormat(undefined, long
    ? { weekday: "long", month: "long", day: "numeric" }
    : { month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00`));
}

export function formatDateTime(value?: string | null) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Unknown time";
}

export function formatClock(value?: string | null) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date) : "—";
}

export function formatNumber(value?: number | string | null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function minutesBetween(start?: string | null, end?: string | null) {
  const a = asDate(start);
  const b = asDate(end);
  return a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000)) : null;
}

export function durationFor(event: WellnessEvent) {
  if (event.ended_at) return minutesBetween(event.started_at, event.ended_at);
  if (event.kind === "fasting") return minutesBetween(event.started_at, new Date().toISOString());
  if (event.kind === "exercise" && event.quantity != null && /min/i.test(event.unit || "")) return Number(event.quantity);
  return null;
}

export function formatDuration(minutes?: number | null) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "—";
  const rounded = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function trackerEntryDisplay(tracker: Tracker, entry?: TrackerEntry | null) {
  if (!entry) return "—";
  if (tracker.value_type === "blood_pressure") {
    const systolic = entry.components?.systolic?.numeric_value;
    const diastolic = entry.components?.diastolic?.numeric_value;
    return systolic != null && diastolic != null ? `${systolic}/${diastolic}` : entry.value_text;
  }
  return `${entry.value_text}${entry.unit ? ` ${entry.unit}` : ""}`;
}

export function eventTitle(event: WellnessEvent) {
  if (event.title) return event.title;
  const label = { sleep: "Sleep", fasting: "Fast", exercise: "Activity", alcohol: "Alcohol" }[event.kind];
  const duration = durationFor(event);
  if (["sleep", "fasting"].includes(event.kind)) return `${label}${duration != null ? ` · ${formatDuration(duration)}` : " started"}`;
  return event.quantity != null ? `${label} · ${formatNumber(event.quantity)} ${event.unit || ""}`.trim() : label;
}

export function effectiveDay(day: string, checkins: Checkin[], trackers: Tracker[], events: WellnessEvent[]): Checkin & { bp_reading_count?: number } {
  const result: Checkin & { bp_reading_count?: number } = { ...(checkins.find((item) => item.day === day) || { day }), day };
  const weight = trackers.find((tracker) => tracker.key === "weight");
  const weightEntry = weight?.entries.find((entry) => entry.day === day);
  if (result.weight_kg == null && weightEntry?.numeric_value != null) {
    result.weight_kg = weightEntry.numeric_value;
  }
  const bp = trackers.find((tracker) => tracker.key === "blood_pressure");
  const readings = (bp?.entries || []).filter((entry) => entry.day === day);
  const latest = readings[0];
  if (latest?.components?.systolic && latest.components.diastolic) {
    result.bp_systolic = latest.components.systolic.numeric_value;
    result.bp_diastolic = latest.components.diastolic.numeric_value;
    result.pulse_bpm = latest.components.pulse?.numeric_value ?? null;
    result.bp_reading_count = readings.length;
  }
  if (result.sleep_minutes == null) {
    const total = events.filter((event) => event.kind === "sleep" && event.ended_at && localDateKey(event.ended_at) === day).reduce((sum, event) => sum + (durationFor(event) || 0), 0);
    if (total) result.sleep_minutes = total;
  }
  if (result.fasting_minutes == null && result.fasting_status !== "skipped") {
    const total = events.filter((event) => event.kind === "fasting" && event.ended_at && localDateKey(event.started_at) === day).reduce((sum, event) => sum + (durationFor(event) || 0), 0);
    if (total) result.fasting_minutes = total;
  }
  if (result.activity_minutes == null && result.activity_status !== "skipped") {
    const total = events.filter((event) => event.kind === "exercise" && localDateKey(event.started_at) === day).reduce((sum, event) => sum + (durationFor(event) || 0), 0);
    if (total) result.activity_minutes = total;
  }
  return result;
}

export function toDateTimeLocal(value?: string | Date | null) {
  const date = value instanceof Date ? value : asDate(value);
  if (!date) return "";
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
