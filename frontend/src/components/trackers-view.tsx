import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Edit3,
  Plus,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  effectiveDay,
  formatDateTime,
  formatDay,
  formatDuration,
  formatNumber,
  localDateKey,
  toDateTimeLocal,
  trackerEntryDisplay,
} from "@/lib/format";
import type {
  Checkin,
  TodayItem,
  Tracker,
  TrackerEntry,
  WellnessEvent,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker, currentTimeValue } from "@/components/ui/time-picker";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
} from "recharts";
import presetCatalog from "@/data/tracker-presets.json";

type TrackerPreset = {
  key: string;
  name: string;
  category: string;
  description: string;
  value_type: Exclude<Tracker["value_type"], "blood_pressure">;
  unit: string;
  frequency: Tracker["frequency"];
  input_min: number | null;
  input_max: number | null;
  input_step: number | null;
  choices: string[];
  goal: { label?: string; minimum?: number; maximum?: number };
};

type OtherTrackerProfile = {
  key: string;
  label: string;
  value_type: Exclude<Tracker["value_type"], "blood_pressure" | "choice">;
  unit: string;
  input_min: number | null;
  input_max: number | null;
  input_step: number | null;
  choices: string[];
};

function validatePresetCatalog() {
  if (
    presetCatalog.version !== 1 ||
    !Array.isArray(presetCatalog.presets) ||
    !Array.isArray(presetCatalog.other_profiles)
  )
    throw new Error("Tracker preset catalog is invalid");
  const presets = presetCatalog.presets as TrackerPreset[];
  const keys = new Set<string>();
  for (const preset of presets) {
    if (!preset.key || !preset.name || !preset.category || keys.has(preset.key))
      throw new Error(
        `Invalid or duplicate tracker preset: ${preset.key || "unknown"}`,
      );
    if (!preset.description || !["daily", "anytime"].includes(preset.frequency))
      throw new Error(`Tracker preset is incomplete: ${preset.key}`);
    if (
      preset.input_min != null &&
      preset.input_max != null &&
      preset.input_min > preset.input_max
    )
      throw new Error(`Tracker preset range is invalid: ${preset.key}`);
    if (preset.input_step != null && preset.input_step <= 0)
      throw new Error(`Tracker preset step is invalid: ${preset.key}`);
    if (preset.value_type === "choice" && preset.choices.length < 2)
      throw new Error(`Tracker preset choices are invalid: ${preset.key}`);
    keys.add(preset.key);
  }
  const profileKeys = new Set<string>();
  for (const profile of presetCatalog.other_profiles as OtherTrackerProfile[]) {
    if (!profile.key || !profile.label || profileKeys.has(profile.key))
      throw new Error(
        `Invalid Other tracker profile: ${profile.key || "unknown"}`,
      );
    if (
      profile.input_min != null &&
      profile.input_max != null &&
      profile.input_min > profile.input_max
    )
      throw new Error(`Other tracker range is invalid: ${profile.key}`);
    if (profile.input_step != null && profile.input_step <= 0)
      throw new Error(`Other tracker step is invalid: ${profile.key}`);
    profileKeys.add(profile.key);
  }
  return presets;
}

const trackerPresets = validatePresetCatalog();
const otherTrackerProfiles =
  presetCatalog.other_profiles as OtherTrackerProfile[];
const trackerCategories = [
  ...new Set(trackerPresets.map((item) => item.category)),
];
const OTHER_TRACKER = "__other__";

type Props = {
  trackers: Tracker[];
  todayItems: TodayItem[];
  checkins: Checkin[];
  events: WellnessEvent[];
  openCheckin: (tab: "sleep" | "fasting" | "activity" | "measure") => void;
  saveTrackerEntry: (payload: {
    tracker_id: string;
    day: string;
    observed_at?: string | null;
    value: unknown;
    context?: string | null;
    note?: string | null;
  }) => Promise<unknown>;
  updateTrackerEntry: (
    entryId: string,
    payload: {
      tracker_id: string;
      day: string;
      observed_at?: string | null;
      value: unknown;
      context?: string | null;
      note?: string | null;
    },
  ) => Promise<unknown>;
  reload: () => Promise<void>;
};

type HistoryRange = "today" | "week" | "month" | "90days";

const historyRanges: { value: HistoryRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "90days", label: "90 days" },
];

const builtInTrendSpecs = [
  {
    key: "fasting",
    name: "Fasting",
    field: "fasting_minutes",
    statusField: "fasting_status",
    tab: "fasting",
    goal: "20 hours",
    valueType: "duration",
    unit: "min",
  },
  {
    key: "activity",
    name: "Activity",
    field: "activity_minutes",
    statusField: "activity_status",
    tab: "activity",
    goal: "60 minutes",
    valueType: "duration",
    unit: "min",
  },
  {
    key: "sleep",
    name: "Sleep",
    field: "sleep_minutes",
    statusField: null,
    tab: "sleep",
    goal: null,
    valueType: "duration",
    unit: "min",
  },
  {
    key: "weight",
    name: "Weight",
    field: "weight_kg",
    statusField: null,
    tab: "measure",
    goal: null,
    valueType: "number",
    unit: "kg",
  },
] as const;

function dateFromKey(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12);
}

function moveDay(day: string, amount: number) {
  const date = dateFromKey(day);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function historyBounds(range: HistoryRange, anchor: string) {
  if (range === "today") return { start: anchor, end: anchor };
  if (range === "90days") return { start: moveDay(anchor, -89), end: anchor };
  const date = dateFromKey(anchor);
  if (range === "week") {
    const mondayOffset = (date.getDay() + 6) % 7;
    return {
      start: moveDay(anchor, -mondayOffset),
      end: moveDay(anchor, 6 - mondayOffset),
    };
  }
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    start: localDateKey(new Date(year, month, 1, 12)),
    end: localDateKey(new Date(year, month + 1, 0, 12)),
  };
}

function daysInBounds(start: string, end: string) {
  const days: string[] = [];
  let cursor = dateFromKey(end);
  const first = dateFromKey(start);
  while (cursor >= first) {
    days.push(localDateKey(cursor));
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() - 1,
      12,
    );
  }
  return days;
}

export function TrackersView({
  trackers,
  todayItems,
  checkins,
  events,
  openCheckin,
  saveTrackerEntry,
  updateTrackerEntry,
  reload,
}: Props) {
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [logging, setLogging] = useState<{
    tracker: Tracker;
    entry?: TrackerEntry;
  } | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("month");
  const historyAnchor = localDateKey();
  const bounds = useMemo(
    () => historyBounds(historyRange, historyAnchor),
    [historyRange, historyAnchor],
  );
  const todayItemLabels: Record<string, string> = {
    sleep: "Sleep",
    rested: "Rested",
    bedtime: "Bedtime",
    fasting: "Fast",
    activity: "Activity",
    weight: "Weight",
    blood_pressure: "Blood pressure",
    pulse: "Pulse",
  };
  const hiddenTodayItems = todayItems.filter((item) => !item.active);
  const builtInTrends = useMemo(
    () =>
      builtInTrendSpecs
        .map((spec) => {
          // Weight belongs to daily check-ins. effectiveDay also folds in any
          // readings left in a legacy configurable weight tracker.
          if (
            spec.key !== "weight" &&
            trackers.some((tracker) => tracker.key === spec.key)
          )
            return null;
          const tracker: Tracker = {
            id: `checkin-${spec.key}`,
            key: spec.key,
            name: spec.name,
            category: "Daily",
            value_type: spec.valueType,
            unit: spec.unit,
            frequency: "daily",
            active: true,
            display_order: 0,
            choices: [],
            goal: spec.goal ? { label: spec.goal } : {},
            entries: [],
          };
          const entries = daysInBounds(bounds.start, bounds.end).flatMap(
            (dayKey) => {
              const day = effectiveDay(dayKey, checkins, trackers, events);
              const minutes = day[spec.field];
              if (minutes == null) return [];
              const skipped =
                spec.statusField && day[spec.statusField] === "skipped";
              return [
                {
                  id: `${spec.key}-${dayKey}`,
                  day: dayKey,
                  occurrence_key: "daily",
                  observed_at: null,
                  value_text: skipped
                    ? "Skipped"
                    : spec.valueType === "duration"
                      ? formatDuration(minutes)
                      : formatNumber(minutes),
                  numeric_value: Number(minutes),
                  unit: spec.valueType === "duration" ? null : spec.unit,
                } satisfies TrackerEntry,
              ];
            },
          );
          return { tracker, entries, tab: spec.tab };
        })
        .filter((item) => item !== null),
    [bounds.start, bounds.end, checkins, trackers, events],
  );

  async function restoreTodayItem(item: TodayItem) {
    try {
      await api(`/api/today-items/${item.key}`, {
        method: "PATCH",
        body: JSON.stringify({ active: true }),
      });
      toast.success(`${todayItemLabels[item.key] || item.key} shown on Today`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 sm:max-w-52">
          <Select
            value={historyRange}
            onValueChange={(value) => setHistoryRange(value as HistoryRange)}
          >
            <SelectTrigger aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {historyRanges.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {hiddenTodayItems.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <span className="mr-1 text-sm text-muted-foreground">
              Hidden from Today
            </span>
            {hiddenTodayItems.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void restoreTodayItem(item)}
              >
                <Plus />
                {todayItemLabels[item.key] || item.key}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {builtInTrends.map(({ tracker, entries, tab }) => (
          <TrackerCard
            key={tracker.id}
            tracker={tracker}
            entries={entries}
            onRecord={() => openCheckin(tab)}
          />
        ))}
        {trackers
          .filter((tracker) => tracker.key !== "weight")
          .map((tracker) => (
            <TrackerCard
              key={tracker.id}
              tracker={tracker}
              entries={tracker.entries.filter(
                (entry) => entry.day >= bounds.start && entry.day <= bounds.end,
              )}
              onEditEntry={(entry) => setLogging({ tracker, entry })}
              onEdit={() => {
                setEditing(tracker);
                setDefinitionOpen(true);
              }}
            />
          ))}
      </div>
      {!trackers.length && (
        <Card className="border-dashed">
          <CardContent className="grid place-items-center gap-3 p-12 text-center">
            <Activity className="size-8 text-muted-foreground" />
            <div>
              <h3 className="font-medium">Nothing added yet</h3>
              <p className="text-sm text-muted-foreground">
                Add blood sugar, hydration, symptoms, or anything else.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Add a measurement from Today.
            </p>
          </CardContent>
        </Card>
      )}
      <TrackerDefinitionDialog
        open={definitionOpen}
        setOpen={setDefinitionOpen}
        tracker={editing}
        trackers={trackers}
        reload={reload}
      />
      <TrackerLogDialog
        tracker={logging?.tracker || null}
        entry={logging?.entry || null}
        setLogging={setLogging}
        selectedDay={historyAnchor}
        save={saveTrackerEntry}
        update={updateTrackerEntry}
      />
    </div>
  );
}

function TrackerCard({
  tracker,
  entries,
  onEditEntry,
  onEdit,
  onRecord,
}: {
  tracker: Tracker;
  entries: TrackerEntry[];
  onEditEntry?: (entry: TrackerEntry) => void;
  onEdit?: () => void;
  onRecord?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const latest = entries[0];
  const previous = entries[1];
  const change = numericChange(tracker, latest, previous);
  return (
    <>
      <Card
        className={`${!tracker.active ? "opacity-65 " : ""}overflow-hidden transition-colors hover:bg-accent/40`}
        data-testid="tracker-trend-card"
        data-entry-count={entries.length}
      >
        <button
          type="button"
          className="w-full p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
          aria-label={`View ${tracker.name} details`}
          onClick={() => setOpen(true)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Badge variant="outline">
                {tracker.category}
                {!tracker.active ? " · Paused" : ""}
              </Badge>
              <h3 className="truncate text-base font-medium">{tracker.name}</h3>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="text-2xl font-semibold tracking-tight">
                  {trackerEntryDisplay(tracker, latest)}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {latest
                    ? latest.observed_at
                      ? formatDateTime(latest.observed_at)
                      : formatDay(latest.day)
                    : "No readings"}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="text-xs">
                {entries.length} reading{entries.length === 1 ? "" : "s"}
              </span>
              <ChevronRight className="size-4" />
            </div>
          </div>
          {entries.length > 0 && (
            <TrackerTrendChart tracker={tracker} entries={entries} compact />
          )}
        </button>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur sm:p-6">
            <DialogTitle className="pr-4 text-xl leading-snug">
              {tracker.name}
            </DialogTitle>
            <DialogDescription>
              {tracker.category} · {entries.length} reading
              {entries.length === 1 ? "" : "s"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tracking-tight">
                  {trackerEntryDisplay(tracker, latest)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latest
                    ? `Latest · ${latest.observed_at ? formatDateTime(latest.observed_at) : formatDay(latest.day)}`
                    : "No readings in this range"}
                </p>
              </div>
              {change && (
                <div className="text-right">
                  <p className="flex items-center justify-end gap-1 text-sm font-medium">
                    {change.direction === "up" ? (
                      <ArrowUpRight className="size-4" />
                    ) : (
                      <ArrowDownRight className="size-4" />
                    )}
                    {change.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    from previous
                  </p>
                </div>
              )}
            </div>

            {entries.length ? (
              <TrackerTrendChart tracker={tracker} entries={entries} />
            ) : (
              <div className="grid h-24 place-items-center rounded-lg bg-muted/35 text-sm text-muted-foreground">
                No readings in this range
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {!tracker.id.startsWith("checkin-") && (
                <Badge variant="secondary">
                  {tracker.frequency === "daily"
                    ? "Once daily"
                    : "Multiple readings"}
                </Badge>
              )}
              {tracker.goal?.label && (
                <Badge variant="outline">
                  <Target className="mr-1 size-3" />
                  {tracker.goal.label}
                </Badge>
              )}
            </div>

            {entries.length > 0 && (
              <section
                className="space-y-2"
                aria-label={`${tracker.name} readings`}
              >
                <h4 className="text-sm font-medium">Readings</h4>
                <div className="max-h-64 divide-y overflow-auto rounded-lg border">
                  {entries.slice(0, 30).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {entry.observed_at
                          ? formatDateTime(entry.observed_at)
                          : formatDay(entry.day)}
                      </span>
                      <div className="flex items-center gap-1">
                        <strong>{trackerEntryDisplay(tracker, entry)}</strong>
                        {onEditEntry && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Edit ${tracker.name} reading from ${formatDay(entry.day)}`}
                            onClick={() => {
                              setOpen(false);
                              onEditEntry(entry);
                            }}
                          >
                            <Edit3 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {(onRecord || onEdit) && (
            <DialogFooter className="sticky bottom-0 border-t bg-background p-5 sm:p-6">
              {onEdit && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onEdit();
                  }}
                >
                  <Edit3 />
                  {!tracker.active ? "Show again" : "Manage"}
                </Button>
              )}
              {onRecord && (
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRecord();
                  }}
                >
                  <Plus />
                  Add reading
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function primaryValue(tracker: Tracker, entry?: TrackerEntry) {
  return tracker.value_type === "blood_pressure"
    ? entry?.components?.systolic?.numeric_value
    : entry?.numeric_value;
}

function numericChange(
  tracker: Tracker,
  latest?: TrackerEntry,
  previous?: TrackerEntry,
) {
  const a = primaryValue(tracker, latest);
  const b = primaryValue(tracker, previous);
  if (a == null || b == null || Number(a) === Number(b)) return null;
  const difference = Number(a) - Number(b);
  return {
    direction: difference > 0 ? "up" : "down",
    label: `${difference > 0 ? "+" : "−"}${
      tracker.value_type === "duration"
        ? formatDuration(Math.abs(difference))
        : `${formatNumber(Math.abs(difference))}${tracker.unit ? ` ${tracker.unit}` : ""}`
    }`,
  };
}

function trendValue(tracker: Tracker, entry: TrackerEntry) {
  const numeric = primaryValue(tracker, entry);
  if (numeric != null && Number.isFinite(Number(numeric)))
    return Number(numeric);
  if (tracker.value_type === "time") {
    const match = entry.value_text.match(/^(\d{1,2}):(\d{2})/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
  }
  if (["choice", "yes_no"].includes(tracker.value_type)) {
    const index = tracker.choices.findIndex(
      (choice) => choice.toLowerCase() === entry.value_text.toLowerCase(),
    );
    if (index >= 0) return index;
  }
  return null;
}

function entryTime(entry: TrackerEntry) {
  const value = entry.observed_at || `${entry.day}T12:00:00`;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : dateFromKey(entry.day).getTime();
}

type TrendPoint = {
  time: number;
  label: string;
  value?: number;
  systolic?: number;
  diastolic?: number;
  skipped?: boolean;
  choice?: string;
};

const chartColors = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--muted-foreground))",
  skipped: "hsl(var(--muted-foreground) / 0.45)",
};

function chartKind(tracker: Tracker, pointCount: number) {
  if (tracker.value_type === "blood_pressure") return "blood-pressure";
  if (pointCount === 1) return "point";
  if (["duration", "choice", "yes_no"].includes(tracker.value_type))
    return "bar";
  if (["water", "steps", "count"].includes(tracker.key)) return "bar";
  return "line";
}

function goalValue(tracker: Tracker) {
  const configured = tracker.goal?.minimum ?? tracker.goal?.maximum;
  if (configured != null && Number.isFinite(Number(configured)))
    return Number(configured);
  if (tracker.value_type !== "duration" || !tracker.goal?.label) return null;
  const match = tracker.goal.label.match(/([\d.]+)\s*(hour|minute)/i);
  if (!match) return null;
  return (
    Number(match[1]) * (match[2].toLowerCase().startsWith("hour") ? 60 : 1)
  );
}

function chartTicks(data: TrendPoint[]) {
  const dayTicks = new Map<string, number>();
  for (const point of data) {
    const day = new Date(point.time).toDateString();
    if (!dayTicks.has(day)) dayTicks.set(day, point.time);
  }
  const candidates =
    dayTicks.size > 1
      ? [...dayTicks.values()]
      : data.map((point) => point.time);
  if (candidates.length <= 4) return candidates;
  const last = candidates.length - 1;
  const indexes = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return [...new Set(indexes.map((index) => candidates[index]))];
}

function formatChartTick(time: number, oneDay: boolean, pointCount: number) {
  return new Intl.DateTimeFormat(
    undefined,
    oneDay && pointCount > 1
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(new Date(time));
}

function chartValueLabel(tracker: Tracker, value: unknown, point?: TrendPoint) {
  if (point?.skipped) return "Skipped";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (tracker.value_type === "duration") return formatDuration(numeric);
  if (tracker.value_type === "time") {
    const hours = Math.floor(numeric / 60) % 24;
    const minutes = Math.round(numeric % 60);
    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (["choice", "yes_no"].includes(tracker.value_type)) {
    return point?.choice ?? tracker.choices[numeric] ?? "—";
  }
  return `${formatNumber(numeric)}${tracker.unit ? ` ${tracker.unit}` : ""}`;
}

function TrackerTrendChart({
  tracker,
  entries,
  compact = false,
}: {
  tracker: Tracker;
  entries: TrackerEntry[];
  compact?: boolean;
}) {
  const data = [...entries].reverse().flatMap((entry): TrendPoint[] => {
    const time = entryTime(entry);
    const label = entry.observed_at
      ? formatDateTime(entry.observed_at)
      : formatDay(entry.day);
    if (tracker.value_type === "blood_pressure") {
      const systolic = entry.components?.systolic?.numeric_value;
      const diastolic = entry.components?.diastolic?.numeric_value;
      if (systolic == null && diastolic == null) return [];
      return [
        {
          time,
          label,
          ...(systolic == null ? {} : { systolic: Number(systolic) }),
          ...(diastolic == null ? {} : { diastolic: Number(diastolic) }),
        },
      ];
    }
    const value = trendValue(tracker, entry);
    if (value == null) return [];
    return [
      {
        time,
        label,
        value,
        skipped: entry.value_text.toLowerCase() === "skipped",
        choice: ["choice", "yes_no"].includes(tracker.value_type)
          ? entry.value_text
          : undefined,
      },
    ];
  });

  if (!data.length) return null;

  const kind = chartKind(tracker, data.length);
  const oneDay =
    new Set(data.map((point) => new Date(point.time).toDateString())).size ===
    1;
  const minTime = Math.min(...data.map((point) => point.time));
  const maxTime = Math.max(...data.map((point) => point.time));
  const timePadding = Math.max((maxTime - minTime) * 0.06, 30 * 60 * 1000);
  const plottedData = data.map((point, index) => ({
    ...point,
    axisKey: `${point.time}-${index}`,
  }));
  const visibleTicks = chartTicks(data);
  const goal = goalValue(tracker);
  const config: ChartConfig =
    tracker.value_type === "blood_pressure"
      ? {
          systolic: { label: "Systolic", color: chartColors.primary },
          diastolic: { label: "Diastolic", color: chartColors.secondary },
        }
      : { value: { label: tracker.name, color: chartColors.primary } };
  const tooltip = (
    <ChartTooltip
      cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "3 3" }}
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) =>
            String(payload[0]?.payload?.label ?? "")
          }
          valueFormatter={(value, _name, item) =>
            chartValueLabel(
              tracker,
              value,
              item.payload as TrendPoint | undefined,
            )
          }
        />
      }
    />
  );
  const commonXAxis = (
    <XAxis
      dataKey="time"
      type="number"
      domain={[minTime - timePadding, maxTime + timePadding]}
      hide
    />
  );
  const barXAxis = (
    <XAxis
      dataKey="axisKey"
      type="category"
      hide
      padding={{ left: 6, right: 6 }}
    />
  );
  const goalLine =
    goal == null ? null : (
      <ReferenceLine
        y={goal}
        stroke="hsl(var(--muted-foreground))"
        strokeDasharray="4 4"
        strokeOpacity={0.65}
      />
    );

  return (
    <div
      className={`w-full rounded-lg bg-muted/20 px-1 ${compact ? "mt-4 pb-1 pt-2" : "pb-2 pt-3"}`}
      role="img"
      aria-label={`${tracker.name} trend, ${kind === "blood-pressure" ? "systolic and diastolic line chart" : `${kind} chart`}`}
      data-chart-kind={kind}
    >
      <ChartContainer
        config={config}
        className={`${compact ? "h-20" : "h-32"} w-full`}
      >
        {kind === "bar" ? (
          <BarChart
            data={plottedData}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid vertical={false} />
            {barXAxis}
            {tooltip}
            {goalLine}
            <Bar
              dataKey="value"
              radius={[5, 5, 2, 2]}
              maxBarSize={28}
              minPointSize={5}
            >
              {data.map((point) => (
                <Cell
                  key={`${point.time}-${point.label}`}
                  fill={
                    point.skipped ? chartColors.skipped : chartColors.primary
                  }
                />
              ))}
            </Bar>
          </BarChart>
        ) : kind === "point" ? (
          <ScatterChart
            data={plottedData}
            margin={{ top: 10, right: 14, bottom: 0, left: 14 }}
          >
            <CartesianGrid vertical={false} />
            {commonXAxis}
            {tooltip}
            {goalLine}
            <Scatter dataKey="value" fill={chartColors.primary} />
          </ScatterChart>
        ) : (
          <LineChart
            data={plottedData}
            margin={{ top: 4, right: 14, bottom: 0, left: 8 }}
          >
            <CartesianGrid vertical={false} />
            {commonXAxis}
            {tooltip}
            {goalLine}
            {kind === "blood-pressure" ? (
              <>
                <Line
                  dataKey="systolic"
                  type="monotone"
                  stroke={chartColors.primary}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "hsl(var(--card))", strokeWidth: 2 }}
                  connectNulls={false}
                />
                <Line
                  dataKey="diastolic"
                  type="monotone"
                  stroke={chartColors.secondary}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "hsl(var(--card))", strokeWidth: 2 }}
                  connectNulls={false}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </>
            ) : (
              <Line
                dataKey="value"
                type="monotone"
                stroke={chartColors.primary}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "hsl(var(--card))", strokeWidth: 2 }}
                connectNulls={false}
              />
            )}
          </LineChart>
        )}
      </ChartContainer>
      {!compact && (
        <div
          aria-hidden="true"
          className={`flex px-2 text-[11px] text-muted-foreground ${visibleTicks.length === 1 ? "justify-center" : "justify-between"}`}
        >
          {visibleTicks.map((time) => (
            <span key={time}>{formatChartTick(time, oneDay, data.length)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrackerLogDialog({
  tracker,
  entry,
  setLogging,
  selectedDay,
  save,
  update,
}: {
  tracker: Tracker | null;
  entry: TrackerEntry | null;
  setLogging: (
    value: { tracker: Tracker; entry?: TrackerEntry } | null,
  ) => void;
  selectedDay: string;
  save: Props["saveTrackerEntry"];
  update: Props["updateTrackerEntry"];
}) {
  const [day, setDay] = useState(selectedDay);
  const [time, setTime] = useState("");
  const [value, setValue] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [context, setContext] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!tracker) return;
    setDay(entry?.day || selectedDay);
    setTime(
      entry?.observed_at
        ? toDateTimeLocal(entry.observed_at).slice(11, 16)
        : tracker.frequency === "anytime"
          ? currentTimeValue()
          : "",
    );
    setValue(entry?.value_text || "");
    setSystolic(
      entry?.components?.systolic?.numeric_value != null
        ? String(entry.components.systolic.numeric_value)
        : "",
    );
    setDiastolic(
      entry?.components?.diastolic?.numeric_value != null
        ? String(entry.components.diastolic.numeric_value)
        : "",
    );
    setPulse(
      entry?.components?.pulse?.numeric_value != null
        ? String(entry.components.pulse.numeric_value)
        : "",
    );
    setContext(entry?.context || "");
    setNote(entry?.note || "");
  }, [tracker, entry, selectedDay]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tracker) return;
    const nextValue =
      tracker.value_type === "blood_pressure"
        ? {
            systolic: Number(systolic),
            diastolic: Number(diastolic),
            ...(pulse ? { pulse: Number(pulse) } : {}),
          }
        : value;
    const observedAt =
      tracker.frequency === "anytime" && time
        ? new Date(`${day}T${time}:00`).toISOString()
        : null;
    try {
      const payload = {
        tracker_id: tracker.id,
        day,
        observed_at: observedAt,
        value: nextValue,
        context: context || null,
        note: note || null,
      };
      if (entry) await update(entry.id, payload);
      else await save(payload);
      toast.success(`${tracker.name} ${entry ? "updated" : "recorded"}`);
      setLogging(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Dialog
      open={Boolean(tracker)}
      onOpenChange={(open) => !open && setLogging(null)}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {entry ? "Edit" : "Add"} {tracker?.name}
            </DialogTitle>
            <DialogDescription>
              {entry
                ? "Update this reading."
                : tracker?.frequency === "anytime"
                  ? "Earlier readings stay here."
                  : "Saving again today updates today’s reading."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Day">
              <DatePicker
                aria-label="Reading day"
                max={localDateKey()}
                value={day}
                onChange={setDay}
              />
            </Field>
            {tracker?.frequency === "anytime" && (
              <Field label="Time">
                <TimePicker
                  aria-label="Reading time"
                  value={time}
                  onChange={setTime}
                />
              </Field>
            )}
            {tracker?.value_type === "blood_pressure" ? (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Systolic">
                  <Input
                    aria-label="Systolic"
                    type="number"
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Diastolic">
                  <Input
                    aria-label="Diastolic"
                    type="number"
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Pulse">
                  <Input
                    aria-label="Pulse"
                    type="number"
                    value={pulse}
                    onChange={(e) => setPulse(e.target.value)}
                  />
                </Field>
              </div>
            ) : ["choice", "yes_no"].includes(tracker?.value_type || "") ? (
              <Field label="Value">
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger aria-label="Reading value">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {tracker?.choices.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {choice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field
                label={`Value${tracker?.unit ? ` (${tracker.unit})` : ""}`}
              >
                <Input
                  aria-label="Reading value"
                  type={tracker?.value_type === "time" ? "time" : "number"}
                  min={tracker?.input_min ?? undefined}
                  max={tracker?.input_max ?? undefined}
                  step={tracker?.input_step ?? "any"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field label="When (optional)">
              <Input
                aria-label="Reading context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Before breakfast, after walk…"
              />
            </Field>
            <Field label="Note (optional)">
              <Textarea
                aria-label="Reading note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLogging(null)}
            >
              Cancel
            </Button>
            <Button type="submit">Save reading</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TrackerDefinitionDialog({
  open,
  setOpen,
  tracker,
  trackers,
  reload,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  tracker: Tracker | null;
  trackers: Tracker[];
  reload: () => Promise<void>;
}) {
  const [category, setCategory] = useState(trackerCategories[0]);
  const [presetKey, setPresetKey] = useState("");
  const [otherName, setOtherName] = useState("");
  const [otherProfileKey, setOtherProfileKey] = useState(
    otherTrackerProfiles[0]?.key || "",
  );
  const [otherFrequency, setOtherFrequency] =
    useState<Tracker["frequency"]>("daily");
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setActive(tracker?.active ?? true);
    if (!tracker) {
      setCategory(trackerCategories[0]);
      setPresetKey("");
      setOtherName("");
      setOtherProfileKey(otherTrackerProfiles[0]?.key || "");
      setOtherFrequency("daily");
    }
  }, [open, tracker]);
  const presetsInCategory = trackerPresets.filter(
    (item) => item.category === category,
  );
  const selectedPreset = trackerPresets.find((item) => item.key === presetKey);
  const selectedOtherProfile = otherTrackerProfiles.find(
    (item) => item.key === otherProfileKey,
  );
  const existingKeys = new Set(trackers.map((item) => item.key));

  function selectCategory(nextCategory: string) {
    setCategory(nextCategory);
    setPresetKey("");
    setOtherName("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let payload: Record<string, unknown>;
    if (tracker) {
      payload = { active };
    } else if (presetKey === OTHER_TRACKER) {
      if (!otherName.trim() || !selectedOtherProfile) return;
      payload = {
        ...selectedOtherProfile,
        name: otherName.trim(),
        category,
        frequency: otherFrequency,
        goal: {},
        active: true,
      };
    } else {
      if (!selectedPreset) return;
      payload = { ...selectedPreset, description: undefined, active: true };
    }
    try {
      await api(tracker ? `/api/trackers/${tracker.id}` : "/api/trackers", {
        method: tracker ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      toast.success(tracker ? "Changes saved" : "Added");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  const displayType = selectedPreset
    ? selectedPreset.value_type === "choice"
      ? "Choose from a list"
      : selectedPreset.value_type === "duration"
        ? "Length of time"
        : "Number"
    : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {tracker ? `Edit ${tracker.name}` : "Add measurement"}
            </DialogTitle>
            <DialogDescription>
              {tracker
                ? "Your past readings are always kept."
                : "Choose what you want to add."}
            </DialogDescription>
          </DialogHeader>
          {tracker ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">Show on Today</p>
                <p className="text-sm text-muted-foreground">
                  Turn this off to stop tracking it. Past readings stay in
                  Trends.
                </p>
              </div>
              <Switch
                aria-label={`Show ${tracker.name} on Today`}
                checked={active}
                onCheckedChange={setActive}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Category">
                <Select value={category} onValueChange={selectCategory}>
                  <SelectTrigger aria-label="Tracker category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {trackerCategories.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="What do you want to track?">
                <Select value={presetKey} onValueChange={setPresetKey}>
                  <SelectTrigger aria-label="Tracker">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {presetsInCategory.map((item) => (
                      <SelectItem
                        key={item.key}
                        value={item.key}
                        disabled={existingKeys.has(item.key)}
                      >
                        {item.name}
                        {existingKeys.has(item.key) ? " · Added" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_TRACKER}>Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {presetKey === OTHER_TRACKER && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Measurement name">
                    <Input
                      value={otherName}
                      onChange={(event) => setOtherName(event.target.value)}
                      placeholder="What do you call it?"
                      maxLength={100}
                      required
                    />
                  </Field>
                  <Field label="How will you record it?">
                    <Select
                      value={otherProfileKey}
                      onValueChange={setOtherProfileKey}
                    >
                      <SelectTrigger aria-label="Recording style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {otherTrackerProfiles.map((item) => (
                          <SelectItem key={item.key} value={item.key}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="How often?">
                    <Select
                      value={otherFrequency}
                      onValueChange={(value) =>
                        setOtherFrequency(value as Tracker["frequency"])
                      }
                    >
                      <SelectTrigger aria-label="Recording frequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Once a day</SelectItem>
                        <SelectItem value="anytime">Any time</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
              {selectedPreset && (
                <div className="rounded-lg border bg-muted/25 p-4">
                  <p className="font-medium">{selectedPreset.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedPreset.description}
                  </p>
                  <dl className="mt-4 divide-y divide-border/60 text-sm">
                    <PresetDetail label="Entry" value={displayType} />
                    {selectedPreset.unit && (
                      <PresetDetail label="Unit" value={selectedPreset.unit} />
                    )}
                    <PresetDetail
                      label="Schedule"
                      value={
                        selectedPreset.frequency === "daily"
                          ? "Once a day"
                          : "Any time"
                      }
                    />
                  </dl>
                </div>
              )}
              {presetKey === OTHER_TRACKER && selectedOtherProfile && (
                <div className="rounded-lg border bg-muted/25 px-4">
                  <dl className="divide-y divide-border/60 text-sm">
                    <PresetDetail
                      label="Entry"
                      value={selectedOtherProfile.label}
                    />
                    {selectedOtherProfile.unit && (
                      <PresetDetail
                        label="Unit"
                        value={selectedOtherProfile.unit}
                      />
                    )}
                    <PresetDetail
                      label="Schedule"
                      value={
                        otherFrequency === "daily" ? "Once a day" : "Any time"
                      }
                    />
                  </dl>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !tracker &&
                (presetKey === OTHER_TRACKER
                  ? !otherName.trim() || !selectedOtherProfile
                  : !selectedPreset || existingKeys.has(selectedPreset.key))
              }
            >
              {tracker ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PresetDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
