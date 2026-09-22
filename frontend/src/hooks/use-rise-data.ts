import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { localDateKey } from "@/lib/format";
import type { CareData, Checkin, DashboardData, HealthHistoryPoint, HealthReport, TodayItem, Tracker, TrackerEntry, WellnessEvent } from "@/types";

const EMPTY_CARE: CareData = { day: localDateKey(), medications: [], appointments: [], reminders: [], summary: {} };
const EMPTY_DATA: DashboardData = { events: [], checkins: [], trackers: [], reports: [], histories: {}, care: EMPTY_CARE, todayItems: [] };

export function useRiseData(days: number, selectedDay: string) {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [events, checkins, trackers, health, care, todayItems] = await Promise.all([
        api<{ events: WellnessEvent[] }>(`/api/events?days=${days}`),
        api<{ checkins: Checkin[] }>(`/api/checkins?days=${days}`),
        api<{ trackers: Tracker[] }>(`/api/trackers?days=${Math.max(days, 90)}&include_inactive=1`),
        api<{ reports: HealthReport[]; histories: Record<string, HealthHistoryPoint[]> }>("/api/health-records"),
        api<CareData>(`/api/care?day=${encodeURIComponent(selectedDay)}&include_inactive=1`),
        api<{ items: TodayItem[] }>("/api/today-items"),
      ]);
      setData({ events: events.events || [], checkins: checkins.checkins || [], trackers: trackers.trackers || [], reports: health.reports || [], histories: health.histories || {}, care, todayItems: todayItems.items || [] });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashboard unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days, selectedDay]);

  useEffect(() => { void load(); }, [load]);

  const saveCheckin = useCallback(async (day: string, payload: Record<string, unknown>) => {
    const body = await api<{ checkin: Checkin }>(`/api/checkins/${day}`, { method: "PUT", body: JSON.stringify(payload) });
    setData((current) => ({
      ...current,
      checkins: [body.checkin, ...current.checkins.filter((item) => item.day !== day)].sort((a, b) => b.day.localeCompare(a.day)),
    }));
    return body.checkin;
  }, []);

  const saveTrackerEntry = useCallback(async (payload: { tracker_id: string; day: string; observed_at?: string | null; value: unknown; context?: string | null; note?: string | null }) => {
    const body = await api<{ entry: TrackerEntry }>("/api/tracker-entries", { method: "POST", body: JSON.stringify(payload) });
    setData((current) => ({
      ...current,
      trackers: current.trackers.map((tracker) => tracker.id === payload.tracker_id
        ? { ...tracker, entries: [body.entry, ...tracker.entries.filter((entry) => !(tracker.frequency === "daily" && entry.day === payload.day && entry.occurrence_key === "daily"))].sort((a, b) => String(b.observed_at || b.day).localeCompare(String(a.observed_at || a.day))) }
        : tracker),
    }));
    return body.entry;
  }, []);

  const updateTrackerEntry = useCallback(async (entryId: string, payload: { tracker_id: string; day: string; observed_at?: string | null; value: unknown; context?: string | null; note?: string | null }) => {
    const body = await api<{ entry: TrackerEntry }>(`/api/tracker-entries/${entryId}`, { method: "PATCH", body: JSON.stringify(payload) });
    setData((current) => ({
      ...current,
      trackers: current.trackers.map((tracker) => tracker.id === payload.tracker_id
        ? { ...tracker, entries: tracker.entries.map((entry) => entry.id === entryId ? body.entry : entry).sort((a, b) => String(b.observed_at || b.day).localeCompare(String(a.observed_at || a.day))) }
        : tracker),
    }));
    return body.entry;
  }, []);

  return { data, loading, refreshing, error, refresh: () => load(true), reload: () => load(true), saveCheckin, saveTrackerEntry, updateTrackerEntry };
}
