import {
  BedDouble,
  Dumbbell,
  Gauge,
  Scale,
  Utensils,
} from "lucide-react";
import {
  effectiveDay,
  formatClock,
  formatDuration,
  formatNumber,
  RESTED_LABELS,
} from "@/lib/format";
import type { Checkin, Tracker, WellnessEvent } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const metrics = [
  { key: "fasting", label: "Fasting", standard: "20:4", icon: Utensils },
  { key: "weight", label: "Weight", standard: "Latest", icon: Scale },
  {
    key: "bp",
    label: "Blood pressure",
    standard: "Multiple readings",
    icon: Gauge,
  },
  { key: "activity", label: "Activity", standard: "60 min", icon: Dumbbell },
  { key: "sleep", label: "Sleep", standard: "Rest & hours", icon: BedDouble },
] as const;

function summaryFor(
  key: (typeof metrics)[number]["key"],
  day: Checkin & { bp_reading_count?: number },
  events: WellnessEvent[],
) {
  if (key === "fasting") {
    if (day.fasting_status === "skipped")
      return { value: "Skipped", detail: "Marked for this day", progress: 0 };
    if (day.fasting_minutes != null)
      return {
        value: formatDuration(day.fasting_minutes),
        detail:
          day.fasting_minutes >= 1200
            ? "20-hour standard reached"
            : "Below 20-hour standard",
        progress: day.fasting_minutes / 12,
      };
    const open = events.find(
      (event) => event.kind === "fasting" && !event.ended_at,
    );
    return open
      ? {
          value: "In progress",
          detail: `Started ${formatClock(open.started_at)}`,
          progress: 25,
        }
      : { value: "—", detail: "Not logged", progress: 0 };
  }
  if (key === "weight")
    return day.weight_kg != null
      ? {
          value: `${formatNumber(day.weight_kg)} kg`,
          detail: "Recorded for this day",
          progress: 100,
        }
      : { value: "—", detail: "No measurement", progress: 0 };
  if (key === "bp")
    return day.bp_systolic != null && day.bp_diastolic != null
      ? {
          value: `${day.bp_systolic}/${day.bp_diastolic}`,
          detail: `${day.bp_reading_count || 1} reading${(day.bp_reading_count || 1) === 1 ? "" : "s"}${day.pulse_bpm ? ` · pulse ${day.pulse_bpm}` : ""}`,
          progress: 100,
        }
      : { value: "—", detail: "No reading", progress: 0 };
  if (key === "activity") {
    if (day.activity_status === "skipped")
      return { value: "Skipped", detail: "Marked for this day", progress: 0 };
    return day.activity_minutes != null
      ? {
          value: formatDuration(day.activity_minutes),
          detail:
            day.activity_minutes >= 60
              ? "60-minute standard reached"
              : "Below 60-minute standard",
          progress: day.activity_minutes / 0.6,
        }
      : { value: "—", detail: "Not logged", progress: 0 };
  }
  return day.sleep_minutes != null || day.rested
    ? {
        value:
          day.sleep_minutes != null
            ? formatDuration(day.sleep_minutes)
            : RESTED_LABELS[day.rested!],
        detail:
          [
            day.rested ? RESTED_LABELS[day.rested] : null,
            day.bedtime ? `Bed ${formatClock(day.bedtime)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Recorded",
        progress: day.sleep_minutes ? day.sleep_minutes / 4.8 : 50,
      }
    : { value: "—", detail: "Not logged", progress: 0 };
}

export function WellnessSummaryCards({
  selectedDay,
  checkins,
  trackers,
  events,
  onEdit,
}: {
  selectedDay: string;
  checkins: Checkin[];
  trackers: Tracker[];
  events: WellnessEvent[];
  onEdit: () => void;
}) {
  const day = effectiveDay(selectedDay, checkins, trackers, events);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5">
      {metrics.map((metric) => {
        const summary = summaryFor(metric.key, day, events);
        const Icon = metric.icon;
        return (
          <Card
            key={metric.key}
            className={cn(
              "cursor-pointer transition-colors hover:border-primary/40",
              metric.key === "sleep" && "col-span-2 xl:col-span-1",
            )}
            onClick={onEdit}
          >
            <CardContent className="p-3.5 sm:p-4">
              <div className="mb-3 flex items-start justify-between gap-2 sm:mb-5">
                <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary">
                  <Icon className="size-4" />
                </span>
                <Badge
                  variant="outline"
                  className="max-w-[7rem] truncate px-1.5 text-[10px] font-normal text-muted-foreground sm:px-2.5 sm:text-xs"
                >
                  {metric.standard}
                </Badge>
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                {summary.value}
              </p>
              <p className="mt-1 min-h-8 text-xs leading-4 text-muted-foreground sm:min-h-5 sm:truncate">
                {summary.detail}
              </p>
              <Progress value={summary.progress} className="mt-3 h-1 sm:mt-4" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
