import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AudioWaveform,
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Droplets,
  Gauge,
  HeartPulse,
  Ellipsis,
  Moon,
  Plus,
  Scale,
  Sunrise,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  effectiveDay,
  formatClock,
  formatDay,
  formatDuration,
  formatNumber,
  localDateKey,
  RESTED_LABELS,
  trackerEntryDisplay,
} from "@/lib/format";
import type {
  Checkin,
  TodayItem,
  Tracker,
  TrackerEntry,
  WellnessEvent,
} from "@/types";
import {
  TrackerDefinitionDialog,
  TrackerLogDialog,
} from "@/components/trackers-view";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimePicker, currentTimeValue } from "@/components/ui/time-picker";

export type CheckinTab = "sleep" | "fasting" | "activity" | "measure";

export type TodayViewProps = {
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  days: number;
  checkins: Checkin[];
  trackers: Tracker[];
  todayItems: TodayItem[];
  events: WellnessEvent[];
  saveCheckin: (
    day: string,
    payload: Record<string, unknown>,
  ) => Promise<Checkin>;
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
  checkinOpen: boolean;
  setCheckinOpen: (open: boolean) => void;
  openCheckin: (tab: CheckinTab) => void;
  openAddMeasurement: () => void;
};

function dayKeyToDate(day: string) {
  return new Date(`${day}T12:00:00`);
}

function shiftDayKey(day: string, amount: number) {
  const date = dayKeyToDate(day);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function minDayKey(first: string, second: string) {
  return first < second ? first : second;
}

function maxDayKey(first: string, second: string) {
  return first > second ? first : second;
}

export function TodayView(props: TodayViewProps) {
  const [logging, setLogging] = useState<{
    tracker: Tracker;
    entry?: TrackerEntry;
  } | null>(null);
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [editingTodayItem, setEditingTodayItem] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const day = useMemo(
    () =>
      effectiveDay(
        props.selectedDay,
        props.checkins,
        props.trackers,
        props.events,
      ),
    [props.selectedDay, props.checkins, props.trackers, props.events],
  );
  const todayKey = localDateKey();
  const earliestDay = useMemo(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (props.days - 1));
    return localDateKey(date);
  }, [props.days]);
  const week = useMemo(() => {
    const start = dayKeyToDate(props.selectedDay);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const key = localDateKey(date);
      return {
        key,
        date,
        day: effectiveDay(key, props.checkins, props.trackers, props.events),
      };
    });
  }, [props.selectedDay, props.checkins, props.trackers, props.events]);
  const previousDay = maxDayKey(
    shiftDayKey(props.selectedDay, -7),
    earliestDay,
  );
  const nextDay = minDayKey(shiftDayKey(props.selectedDay, 7), todayKey);
  const builtinTrackerKeys = new Set(["weight", "blood_pressure"]);
  const todayItemActive = new Map(
    props.todayItems.map((item) => [item.key, item.active]),
  );
  const selectedCheckin = [
    {
      id: "sleep",
      todayItemKey: "sleep",
      label: "Sleep",
      icon: Moon,
      value:
        day.sleep_minutes != null ? formatDuration(day.sleep_minutes) : "—",
      onClick: () => props.openCheckin("sleep"),
      onOptions: () => setEditingTodayItem({ key: "sleep", label: "Sleep" }),
    },
    {
      id: "rested",
      todayItemKey: "rested",
      label: "Rested",
      icon: Sunrise,
      value: day.rested ? RESTED_LABELS[day.rested] : "—",
      onClick: () => props.openCheckin("sleep"),
      onOptions: () => setEditingTodayItem({ key: "rested", label: "Rested" }),
    },
    {
      id: "bedtime",
      todayItemKey: "bedtime",
      label: "Bedtime",
      icon: Clock3,
      value: day.bedtime ? formatClock(day.bedtime) : "—",
      onClick: () => props.openCheckin("sleep"),
      onOptions: () =>
        setEditingTodayItem({ key: "bedtime", label: "Bedtime" }),
    },
    {
      id: "fasting",
      todayItemKey: "fasting",
      label: "Fast",
      icon: Utensils,
      value:
        day.fasting_status === "skipped"
          ? "Skip"
          : day.fasting_minutes != null
            ? formatDuration(day.fasting_minutes)
            : "—",
      onClick: () => props.openCheckin("fasting"),
      onOptions: () => setEditingTodayItem({ key: "fasting", label: "Fast" }),
    },
    {
      id: "activity",
      todayItemKey: "activity",
      label: "Activity",
      icon: Activity,
      value:
        day.activity_status === "skipped"
          ? "Skip"
          : day.activity_minutes != null
            ? formatDuration(day.activity_minutes)
            : "—",
      onClick: () => props.openCheckin("activity"),
      onOptions: () =>
        setEditingTodayItem({ key: "activity", label: "Activity" }),
    },
    {
      id: "weight",
      todayItemKey: "weight",
      label: "Weight",
      icon: Scale,
      value: day.weight_kg != null ? `${formatNumber(day.weight_kg)} kg` : "—",
      onClick: () => props.openCheckin("measure"),
      onOptions: () => setEditingTodayItem({ key: "weight", label: "Weight" }),
    },
    {
      id: "blood_pressure",
      todayItemKey: "blood_pressure",
      label: "Blood pressure",
      icon: HeartPulse,
      value:
        day.bp_systolic != null && day.bp_diastolic != null
          ? `${day.bp_systolic}/${day.bp_diastolic}`
          : "—",
      onClick: () => props.openCheckin("measure"),
      onOptions: () =>
        setEditingTodayItem({ key: "blood_pressure", label: "Blood pressure" }),
    },
    {
      id: "pulse",
      todayItemKey: "pulse",
      label: "Pulse",
      icon: AudioWaveform,
      value: day.pulse_bpm != null ? `${formatNumber(day.pulse_bpm)} bpm` : "—",
      onClick: () => props.openCheckin("measure"),
      onOptions: () => setEditingTodayItem({ key: "pulse", label: "Pulse" }),
    },
    ...props.trackers
      .filter(
        (tracker) => tracker.active && !builtinTrackerKeys.has(tracker.key),
      )
      .map((tracker) => ({
        id: tracker.id,
        label: tracker.name,
        icon: Gauge,
        value: trackerEntryDisplay(
          tracker,
          tracker.entries.find((entry) => entry.day === props.selectedDay),
        ),
        onClick: () => setLogging({ tracker }),
        onOptions: () => setEditing(tracker),
      })),
  ].filter(
    (item) =>
      !("todayItemKey" in item) ||
      todayItemActive.get(item.todayItemKey) !== false,
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      <Card
        data-testid="today-surface"
        className="border-0 bg-transparent shadow-none md:border md:bg-card md:shadow-sm"
      >
        <CardHeader className="flex-row items-center justify-between space-y-0 px-0 pb-3 pt-1 md:p-6 md:pb-3">
          <CardDescription>
            {formatDay(week[0].key)} – {formatDay(week[6].key)}
          </CardDescription>
          <div className="flex items-center gap-1">
            {props.selectedDay !== todayKey && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2.5 text-xs"
                aria-label="Go to today"
                onClick={() => props.setSelectedDay(todayKey)}
              >
                Today
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-9"
              aria-label="Previous week"
              disabled={week[0].key <= earliestDay}
              onClick={() => props.setSelectedDay(previousDay)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-9"
              aria-label="Next week"
              disabled={week[6].key >= todayKey}
              onClick={() => props.setSelectedDay(nextDay)}
            >
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-0 md:p-6 md:pt-0">
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1.5">
            {week.map(({ key, date, day: calendarDay }) => {
              const disabled = key < earliestDay || key > todayKey;
              const states = [
                calendarDay.sleep_minutes != null ||
                  Boolean(calendarDay.rested) ||
                  Boolean(calendarDay.bedtime),
                calendarDay.fasting_minutes != null ||
                  Boolean(calendarDay.fasting_status),
                calendarDay.activity_minutes != null ||
                  Boolean(calendarDay.activity_status),
              ];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  aria-label={`${formatDay(key, true)}${key === todayKey ? ", today" : ""}`}
                  aria-pressed={key === props.selectedDay}
                  onClick={() => props.setSelectedDay(key)}
                  className={cn(
                    "grid min-h-[4.75rem] place-items-center rounded-2xl border border-transparent px-0.5 py-2 text-center transition-colors disabled:opacity-30 sm:min-h-[4.5rem] sm:rounded-lg sm:px-1",
                    key === props.selectedDay
                      ? "border-primary bg-primary/[0.08] text-foreground"
                      : "text-muted-foreground hover:border-primary/40 md:bg-muted/25",
                  )}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide">
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <strong className="text-base leading-none">
                    {date.getDate()}
                  </strong>
                  <span className="flex gap-1" aria-hidden="true">
                    {states.map((recorded, index) => (
                      <span
                        key={index}
                        className={cn(
                          "size-1.5 rounded-full",
                          recorded ? "bg-primary" : "bg-muted-foreground/25",
                        )}
                      />
                    ))}
                  </span>
                  <span className="sr-only">
                    {states.filter(Boolean).length} of 3 added
                  </span>
                </button>
              );
            })}
          </div>
          <div className="divide-y divide-border/70 border-t border-border/70 md:rounded-lg md:border-t-0 md:bg-muted/25 md:px-3">
            {selectedCheckin.map((item) => (
              <RhythmValue
                key={item.id}
                label={item.label}
                value={item.value}
                icon={item.icon}
                onClick={item.onClick}
                onOptions={"onOptions" in item ? item.onOptions : undefined}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              className="h-14 w-full justify-start gap-3 rounded-none px-0 text-[15px] font-normal text-primary hover:bg-transparent hover:text-primary md:h-10 md:px-2 md:text-sm"
              onClick={props.openAddMeasurement}
            >
              <Plus className="size-5" />
              Add measurement
            </Button>
          </div>
        </CardContent>
      </Card>
      <TrackerLogDialog
        tracker={logging?.tracker || null}
        entry={logging?.entry || null}
        setLogging={setLogging}
        selectedDay={props.selectedDay}
        save={props.saveTrackerEntry}
        update={props.updateTrackerEntry}
      />
      <TrackerDefinitionDialog
        open={Boolean(editing)}
        setOpen={(open) => !open && setEditing(null)}
        tracker={editing}
        trackers={props.trackers}
        reload={props.reload}
      />
      <TodayItemDialog
        item={editingTodayItem}
        setItem={setEditingTodayItem}
        reload={props.reload}
      />
    </div>
  );
}

function TodayItemDialog({
  item,
  setItem,
  reload,
}: {
  item: { key: string; label: string } | null;
  setItem: (item: { key: string; label: string } | null) => void;
  reload: () => Promise<void>;
}) {
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (item) setActive(true);
  }, [item]);

  async function save() {
    if (!item) return;
    try {
      await api(`/api/today-items/${item.key}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      toast.success(
        active
          ? `${item.label} shown on Today`
          : `${item.label} removed from Today`,
      );
      setItem(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => !open && setItem(null)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item?.label}</DialogTitle>
          <DialogDescription>
            Past entries stay in Trends if you remove this from Today.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <Label htmlFor="today-item-active">Show on Today</Label>
          <Switch
            id="today-item-active"
            checked={active}
            onCheckedChange={setActive}
            aria-label={`Show ${item?.label || "item"} on Today`}
          />
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RhythmValue({
  label,
  value,
  icon: Icon,
  onClick,
  onOptions,
  className = "",
}: {
  label: string;
  value: string;
  icon: typeof Moon;
  onClick?: () => void;
  onOptions?: () => void;
  className?: string;
}) {
  const content = (
    <button
      type="button"
      className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left transition-colors active:bg-muted/40 md:min-h-0 md:py-2.5"
      onClick={onClick}
      aria-label={`Record ${label}`}
    >
      <span className="flex min-w-0 items-center gap-3 truncate text-[15px] text-foreground md:text-xs md:text-muted-foreground">
        <Icon className="size-5 shrink-0 text-primary md:hidden" />
        <span className="truncate">{label}</span>
      </span>
      <strong className="truncate text-base font-medium md:text-sm">
        {value}
      </strong>
    </button>
  );
  return (
    <div className={cn("flex min-h-14 items-center gap-1", className)}>
      {content}
      {onOptions && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0"
          aria-label={`${label} options`}
          onClick={onOptions}
        >
          <Ellipsis />
        </Button>
      )}
    </div>
  );
}

function ChoiceRow({
  options,
  selected,
  onSelect,
}: {
  options: { label: string; value: string | number }[];
  selected?: string | number | null;
  onSelect: (value: string | number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={
            String(selected) === String(option.value) ? "default" : "outline"
          }
          className="h-11"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function CheckinDialog(
  props: TodayViewProps & {
    open: boolean;
    setOpen: (open: boolean) => void;
    initialTab: CheckinTab;
  },
) {
  const day = effectiveDay(
    props.selectedDay,
    props.checkins,
    props.trackers,
    props.events,
  );
  const [sleepHours, setSleepHours] = useState("");
  const [bedtime, setBedtime] = useState("");
  const [fastingHours, setFastingHours] = useState("");
  const [activityMinutes, setActivityMinutes] = useState("");
  const [weight, setWeight] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [activeTab, setActiveTab] = useState<CheckinTab>(props.initialTab);
  const bpTracker = props.trackers.find(
    (tracker) => tracker.key === "blood_pressure",
  );

  useEffect(() => {
    setSleepHours(
      day.sleep_minutes != null ? String(day.sleep_minutes / 60) : "",
    );
    const bed = day.bedtime ? new Date(day.bedtime) : null;
    setBedtime(
      bed
        ? `${String(bed.getHours()).padStart(2, "0")}:${String(bed.getMinutes()).padStart(2, "0")}`
        : currentTimeValue(),
    );
    setFastingHours(
      day.fasting_minutes != null && day.fasting_status !== "skipped"
        ? String(day.fasting_minutes / 60)
        : "",
    );
    setActivityMinutes(
      day.activity_minutes != null && day.activity_status !== "skipped"
        ? String(day.activity_minutes)
        : "",
    );
    setWeight(day.weight_kg != null ? String(day.weight_kg) : "");
    setSystolic("");
    setDiastolic("");
    setPulse("");
  }, [props.selectedDay, props.open]);

  useEffect(() => {
    if (props.open) setActiveTab(props.initialTab);
  }, [props.open, props.initialTab]);

  async function save(payload: Record<string, unknown>, message: string) {
    try {
      await props.saveCheckin(props.selectedDay, payload);
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  async function saveBp() {
    if (!bpTracker || !systolic || !diastolic)
      return toast.error("Enter both blood pressure numbers");
    const value: Record<string, number> = {
      systolic: Number(systolic),
      diastolic: Number(diastolic),
    };
    if (pulse) value.pulse = Number(pulse);
    try {
      await props.saveTrackerEntry({
        tracker_id: bpTracker.id,
        day: props.selectedDay,
        observed_at:
          props.selectedDay === localDateKey()
            ? new Date().toISOString()
            : null,
        value,
      });
      toast.success("Blood pressure recorded");
      setSystolic("");
      setDiastolic("");
      setPulse("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  const dailyTrackers = props.trackers.filter(
    (tracker) =>
      tracker.active &&
      tracker.frequency === "daily" &&
      tracker.key !== "weight" &&
      tracker.value_type !== "blood_pressure",
  );

  return (
    <Dialog open={props.open} onOpenChange={props.setOpen}>
      <DialogContent className="mobile-checkin-sheet max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur sm:p-6">
          <DialogTitle className="font-display text-2xl font-normal">
            Daily check-in
          </DialogTitle>
          <DialogDescription>Add what happened today.</DialogDescription>
          <div className="pt-2">
            <Label className="sr-only">Check-in day</Label>
            <DatePicker
              aria-label="Check-in day"
              max={localDateKey()}
              value={props.selectedDay}
              onChange={(day) => props.setSelectedDay(day || localDateKey())}
            />
          </div>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CheckinTab)}
          className="p-5 pt-2 sm:p-6 sm:pt-3"
        >
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1">
            <TabsTrigger
              value="sleep"
              className="flex-col gap-1 px-1 py-2 text-[11px] sm:flex-row sm:text-sm"
            >
              <BedDouble className="size-4" />
              <span>Sleep</span>
            </TabsTrigger>
            <TabsTrigger
              value="fasting"
              className="flex-col gap-1 px-1 py-2 text-[11px] sm:flex-row sm:text-sm"
            >
              <Utensils className="size-4" />
              <span>Fast</span>
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="flex-col gap-1 px-1 py-2 text-[11px] sm:flex-row sm:text-sm"
            >
              <Activity className="size-4" />
              <span>Move</span>
            </TabsTrigger>
            <TabsTrigger
              value="measure"
              className="flex-col gap-1 px-1 py-2 text-[11px] sm:flex-row sm:text-sm"
            >
              <Gauge className="size-4" />
              <span>Measure</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sleep" className="space-y-6 pt-4">
            <Question title="Do you feel rested?" hint="Your morning check-in">
              <ChoiceRow
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "Somewhat", value: "somewhat" },
                  { label: "No", value: "no" },
                ]}
                selected={day.rested}
                onSelect={(value) =>
                  void save({ rested: value }, "Rest recorded")
                }
              />
            </Question>
            <Question title="How long did you sleep?">
              <ChoiceRow
                options={[
                  { label: "6h", value: 360 },
                  { label: "7h", value: 420 },
                  { label: "8h", value: 480 },
                ]}
                selected={day.sleep_minutes}
                onSelect={(value) =>
                  void save({ sleep_minutes: value }, "Sleep recorded")
                }
              />
              <InlineSave
                label="Actual hours"
                value={sleepHours}
                onChange={setSleepHours}
                type="number"
                step="0.25"
                onSave={() =>
                  sleepHours &&
                  void save(
                    { sleep_minutes: Number(sleepHours) * 60 },
                    "Sleep recorded",
                  )
                }
              />
            </Question>
            <Question title="When did you go to bed?" hint="Evening check-in">
              <InlineSave
                label="Bedtime"
                value={bedtime}
                onChange={setBedtime}
                type="time"
                onSave={() => {
                  if (!bedtime) return;
                  const [hour, minute] = bedtime.split(":").map(Number);
                  const date = new Date(`${props.selectedDay}T00:00:00`);
                  if (hour >= 12) date.setDate(date.getDate() - 1);
                  date.setHours(hour, minute, 0, 0);
                  void save(
                    { bedtime: date.toISOString() },
                    "Bedtime recorded",
                  );
                }}
              />
            </Question>
          </TabsContent>
          <TabsContent value="fasting" className="space-y-6 pt-4">
            <Question title="How did fasting go?" hint="20:4 is your standard">
              <ChoiceRow
                options={[
                  { label: "20h", value: 1200 },
                  { label: "18h", value: 1080 },
                  { label: "Skipped", value: "skipped" },
                ]}
                selected={
                  day.fasting_status === "skipped"
                    ? "skipped"
                    : day.fasting_minutes
                }
                onSelect={(value) =>
                  value === "skipped"
                    ? void save(
                        { fasting_status: "skipped", fasting_minutes: 0 },
                        "Fasting marked skipped",
                      )
                    : void save({ fasting_minutes: value }, "Fasting recorded")
                }
              />
              <InlineSave
                label="Actual hours"
                value={fastingHours}
                onChange={setFastingHours}
                type="number"
                step="0.25"
                onSave={() =>
                  fastingHours &&
                  void save(
                    { fasting_minutes: Number(fastingHours) * 60 },
                    "Fasting recorded",
                  )
                }
              />
            </Question>
          </TabsContent>
          <TabsContent value="activity" className="space-y-6 pt-4">
            <Question
              title="How much activity?"
              hint="60 minutes is your standard"
            >
              <ChoiceRow
                options={[
                  { label: "60m", value: 60 },
                  { label: "30m", value: 30 },
                  { label: "Skipped", value: "skipped" },
                ]}
                selected={
                  day.activity_status === "skipped"
                    ? "skipped"
                    : day.activity_minutes
                }
                onSelect={(value) =>
                  value === "skipped"
                    ? void save(
                        { activity_status: "skipped", activity_minutes: 0 },
                        "Activity marked skipped",
                      )
                    : void save(
                        { activity_minutes: value },
                        "Activity recorded",
                      )
                }
              />
              <InlineSave
                label="Actual minutes"
                value={activityMinutes}
                onChange={setActivityMinutes}
                type="number"
                step="1"
                onSave={() =>
                  activityMinutes &&
                  void save(
                    { activity_minutes: Number(activityMinutes) },
                    "Activity recorded",
                  )
                }
              />
            </Question>
          </TabsContent>
          <TabsContent value="measure" className="space-y-6 pt-4">
            <Question title="Weight">
              <InlineSave
                label="Kilograms"
                value={weight}
                onChange={setWeight}
                type="number"
                step="0.1"
                onSave={() =>
                  weight &&
                  void save({ weight_kg: Number(weight) }, "Weight recorded")
                }
              />
            </Question>
            <Question title="Blood pressure" hint="Every reading is kept">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  aria-label="Systolic"
                  type="number"
                  inputMode="numeric"
                  placeholder="120"
                  value={systolic}
                  onChange={(event) => setSystolic(event.target.value)}
                />
                <Input
                  aria-label="Diastolic"
                  type="number"
                  inputMode="numeric"
                  placeholder="80"
                  value={diastolic}
                  onChange={(event) => setDiastolic(event.target.value)}
                />
                <Input
                  aria-label="Pulse"
                  type="number"
                  inputMode="numeric"
                  placeholder="Pulse"
                  value={pulse}
                  onChange={(event) => setPulse(event.target.value)}
                />
              </div>
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => void saveBp()}
              >
                <Droplets />
                Save reading
              </Button>
            </Question>
            {dailyTrackers.map((tracker) => (
              <CustomTrackerQuestion
                key={tracker.id}
                tracker={tracker}
                day={props.selectedDay}
                save={props.saveTrackerEntry}
              />
            ))}
          </TabsContent>
        </Tabs>
        <DialogFooter className="sticky bottom-0 border-t bg-background p-4 sm:p-5">
          <Button
            className="w-full sm:w-auto"
            onClick={() => props.setOpen(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-b bg-transparent px-0 py-4 last:border-b-0 sm:rounded-lg sm:border sm:bg-card sm:p-4">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function InlineSave({
  label,
  value,
  onChange,
  onSave,
  type,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  type: "number" | "time";
  step?: string;
}) {
  return (
    <div className="flex gap-2">
      {type === "time" ? (
        <TimePicker
          className="min-w-0 flex-1"
          aria-label={label}
          value={value}
          onChange={onChange}
        />
      ) : (
        <Input
          aria-label={label}
          type="number"
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={label}
        />
      )}
      <Button type="button" variant="secondary" onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

function CustomTrackerQuestion({
  tracker,
  day,
  save,
}: {
  tracker: Tracker;
  day: string;
  save: TodayViewProps["saveTrackerEntry"];
}) {
  const [value, setValue] = useState(() =>
    tracker.value_type === "time" ? currentTimeValue() : "",
  );
  async function submit(next = value) {
    if (!next) return;
    try {
      await save({ tracker_id: tracker.id, day, value: next });
      toast.success(`${tracker.name} recorded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Question title={tracker.name} hint={tracker.unit || tracker.category}>
      {["choice", "yes_no"].includes(tracker.value_type) ? (
        <div className="flex flex-wrap gap-2">
          {tracker.choices.map((choice) => (
            <Button
              key={choice}
              variant="outline"
              onClick={() => void submit(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : (
        <InlineSave
          label={tracker.unit || "Value"}
          value={value}
          onChange={setValue}
          type={tracker.value_type === "time" ? "time" : "number"}
          step={String(tracker.input_step || "any")}
          onSave={() => void submit()}
        />
      )}
    </Question>
  );
}
