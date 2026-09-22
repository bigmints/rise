import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  MapPin,
  Pill,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  formatClock,
  formatDateTime,
  localDateKey,
  toDateTimeLocal,
  toIso,
} from "@/lib/format";
import type { Appointment, CareData, Medication, Reminder } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
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

export function CareView({
  care,
  selectedDay,
  setSelectedDay,
  reload,
}: {
  care: CareData;
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  reload: () => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [medicationOpen, setMedicationOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(
    null,
  );
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

  async function scheduledDose(
    medication: Medication,
    time: string,
    status: "taken" | "skipped",
  ) {
    try {
      await api("/api/medication-doses", {
        method: "POST",
        body: JSON.stringify({
          medication_id: medication.id,
          day: selectedDay,
          scheduled_time: time,
          observed_at: new Date().toISOString(),
          status,
        }),
      });
      toast.success(
        status === "taken" ? "Dose marked taken" : "Dose marked skipped",
      );
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  async function completeReminder(reminder: Reminder) {
    try {
      await api(`/api/reminders/${reminder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
      toast.success("Follow-up marked done");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DatePicker
          aria-label="Care day"
          className="min-w-0 flex-1 sm:max-w-64"
          value={selectedDay}
          onChange={(day) => setSelectedDay(day || localDateKey())}
        />
        <Button onClick={() => setAddOpen(true)} aria-label="Add care item">
          <Plus />
          Add
        </Button>
      </div>

      <section className="space-y-2" aria-labelledby="medicines-heading">
        <div className="flex items-center justify-between px-1">
          <h2 id="medicines-heading" className="text-lg font-semibold">
            Medicines
          </h2>
          <span className="text-xs text-muted-foreground">
            {care.medications.length}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
            {care.medications.map((medication) => (
              <MedicationCard
                key={medication.id}
                medication={medication}
                selectedDay={selectedDay}
                onEdit={() => {
                  setEditingMedication(medication);
                  setMedicationOpen(true);
                }}
                onDose={scheduledDose}
                reload={reload}
              />
            ))}
            {!care.medications.length && (
              <Empty text="No medicines" />
            )}
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="visits-heading">
        <div className="flex items-center justify-between px-1">
          <h2 id="visits-heading" className="text-lg font-semibold">
            Visits & reminders
          </h2>
          <span className="text-xs text-muted-foreground">
            {care.appointments.length + care.reminders.length}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
            {care.appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onEdit={() => {
                  setEditingAppointment(appointment);
                  setAppointmentOpen(true);
                }}
              />
            ))}
            {care.reminders.map((reminder) => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                onEdit={() => {
                  setEditingReminder(reminder);
                  setReminderOpen(true);
                }}
                onDone={() => void completeReminder(reminder)}
              />
            ))}
            {!care.appointments.length && !care.reminders.length && (
              <Empty text="No visits or reminders" />
            )}
        </div>
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="mobile-detail-sheet max-w-md overflow-hidden p-0">
          <DialogHeader className="border-b p-5 pr-12">
            <DialogTitle>Add</DialogTitle>
            <DialogDescription>Choose what to add.</DialogDescription>
          </DialogHeader>
          <div className="divide-y p-2">
            <CareChoice
              icon={Pill}
              label="Medicine"
              onClick={() => {
                setAddOpen(false);
                setEditingMedication(null);
                setMedicationOpen(true);
              }}
            />
            <CareChoice
              icon={CalendarClock}
              label="Appointment"
              onClick={() => {
                setAddOpen(false);
                setEditingAppointment(null);
                setAppointmentOpen(true);
              }}
            />
            <CareChoice
              icon={Clock3}
              label="Reminder"
              onClick={() => {
                setAddOpen(false);
                setEditingReminder(null);
                setReminderOpen(true);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
      <MedicationDialog
        open={medicationOpen}
        setOpen={setMedicationOpen}
        medication={editingMedication}
        selectedDay={selectedDay}
        reload={reload}
      />
      <AppointmentDialog
        open={appointmentOpen}
        setOpen={setAppointmentOpen}
        appointment={editingAppointment}
        reload={reload}
      />
      <ReminderDialog
        open={reminderOpen}
        setOpen={setReminderOpen}
        reminder={editingReminder}
        appointments={care.appointments}
        reload={reload}
      />
    </div>
  );
}

function MedicationCard({
  medication,
  selectedDay,
  onEdit,
  onDose,
  reload,
}: {
  medication: Medication;
  selectedDay: string;
  onEdit: () => void;
  onDose: (
    medication: Medication,
    time: string,
    status: "taken" | "skipped",
  ) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [doseOpen, setDoseOpen] = useState(false);
  const schedule =
    medication.schedule_kind === "as_needed"
      ? "As needed"
      : medication.schedule_kind === "daily"
        ? `Daily · ${medication.schedule_times.map((time) => formatClock(`${selectedDay}T${time}:00`)).join(" · ")}`
        : `Selected days · ${medication.schedule_times.map((time) => formatClock(`${selectedDay}T${time}:00`)).join(" · ")}`;
  const planned =
    medication.active &&
    medication.schedule_kind !== "as_needed" &&
    medication.scheduled_on_day
      ? medication.schedule_times.length
      : 0;
  const taken = new Set(
    medication.doses
      .filter((dose) => dose.status === "taken" && dose.scheduled_time)
      .map((dose) => dose.scheduled_time),
  ).size;
  const summary = !medication.active
    ? "Paused"
    : medication.schedule_kind === "as_needed"
      ? "As needed"
      : planned
        ? `${taken} of ${planned} taken`
        : "Not scheduled today";
  return (
    <>
      <Card className={`${!medication.active ? "opacity-65 " : ""}overflow-hidden transition-colors hover:bg-accent/40`}>
        <button
          type="button"
          className="flex min-h-20 w-full items-center justify-between gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`View ${medication.name} medication`}
          onClick={() => setOpen(true)}
        >
          <div className="min-w-0">
            <h3 className="truncate font-medium">
              {medication.name}
              {medication.strength ? ` ${medication.strength}` : ""}
            </h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {summary}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur">
            <DialogTitle>{medication.name}</DialogTitle>
            <DialogDescription>
              {[medication.strength, schedule].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Today</span>
              <Badge variant={medication.active ? "secondary" : "outline"}>
                {summary}
              </Badge>
            </div>
            {medication.instructions && (
              <p className="text-sm">{medication.instructions}</p>
            )}
            {medication.active && medication.schedule_kind === "as_needed" && (
              <Button className="w-full" onClick={() => setDoseOpen(true)}>
                Log dose
              </Button>
            )}
            {medication.active &&
              medication.schedule_kind !== "as_needed" &&
              medication.scheduled_on_day && (
          <div className="divide-y rounded-lg border">
            {medication.schedule_times.map((time) => {
              const dose = medication.doses.find(
                (item) => item.scheduled_time === time,
              );
              return (
                <div
                  key={time}
                  className="flex items-center justify-between gap-2 p-3"
                >
                  <div>
                    <strong className="text-sm">
                      {formatClock(`${selectedDay}T${time}:00`)}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      {dose
                        ? dose.status === "taken"
                          ? "Taken"
                          : "Skipped"
                        : "Not logged"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={dose?.status === "taken" ? "default" : "outline"}
                      onClick={() => void onDose(medication, time, "taken")}
                    >
                      Taken
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        dose?.status === "skipped" ? "secondary" : "ghost"
                      }
                      onClick={() => void onDose(medication, time, "skipped")}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
            {medication.note && (
              <p className="text-sm text-muted-foreground">{medication.note}</p>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                window.setTimeout(onEdit, 150);
              }}
            >
              Edit medicine
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <DoseDialog
        open={doseOpen}
        setOpen={setDoseOpen}
        medication={medication}
        selectedDay={selectedDay}
        reload={reload}
      />
    </>
  );
}

function AppointmentCard({
  appointment,
  onEdit,
}: {
  appointment: Appointment;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="overflow-hidden transition-colors hover:bg-accent/40">
        <button
          type="button"
          className="flex min-h-20 w-full items-center justify-between gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`View ${appointment.title} appointment`}
          onClick={() => setOpen(true)}
        >
          <div className="min-w-0">
            <h3 className="truncate font-medium">{appointment.title}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {formatDateTime(appointment.starts_at)}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur">
            <DialogTitle>{appointment.title}</DialogTitle>
            <DialogDescription>{formatDateTime(appointment.starts_at)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <Badge variant="secondary" className="capitalize">
              {appointment.status}
            </Badge>
            {(appointment.provider || appointment.location) && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                {[appointment.provider, appointment.location].filter(Boolean).join(" · ")}
              </p>
            )}
            {appointment.note && <p className="text-sm">{appointment.note}</p>}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                window.setTimeout(onEdit, 150);
              }}
            >
              Edit appointment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReminderCard({
  reminder,
  onEdit,
  onDone,
}: {
  reminder: Reminder;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className={`${reminder.overdue ? "border-destructive/60 " : ""}overflow-hidden transition-colors hover:bg-accent/40`}>
        <button
          type="button"
          className="flex min-h-20 w-full items-center justify-between gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`View ${reminder.title} reminder`}
          onClick={() => setOpen(true)}
        >
          <div className="min-w-0">
            <h3 className="truncate font-medium">{reminder.title}</h3>
            <p className={`mt-1 truncate text-sm ${reminder.overdue ? "text-destructive" : "text-muted-foreground"}`}>
              {reminder.overdue ? "Overdue" : `Due ${formatDateTime(reminder.due_at)}`}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur">
            <DialogTitle>{reminder.title}</DialogTitle>
            <DialogDescription>
              {reminder.overdue ? "Overdue" : `Due ${formatDateTime(reminder.due_at)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-5">
            {reminder.note && <p className="text-sm">{reminder.note}</p>}
            {reminder.status === "pending" && (
              <Button className="w-full" onClick={onDone}>
                <Check />
                Mark done
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                window.setTimeout(onEdit, 150);
              }}
            >
              Edit reminder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CareChoice({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Pill;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-4 text-base"
      onClick={onClick}
    >
      <Icon className="size-5" />
      {label}
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </Button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground lg:col-span-2">
      {text} yet.
    </div>
  );
}

function MedicationDialog({
  open,
  setOpen,
  medication,
  selectedDay,
  reload,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  medication: Medication | null;
  selectedDay: string;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState("daily");
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState(selectedDay);
  const [end, setEnd] = useState("");
  const [active, setActive] = useState(true);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(medication?.name || "");
    setStrength(medication?.strength || "");
    setInstructions(medication?.instructions || "");
    setKind(medication?.schedule_kind || "daily");
    setTimes(
      medication?.schedule_times.length ? medication.schedule_times : ["08:00"],
    );
    setDays(medication?.schedule_days || []);
    setStart(medication?.start_date || selectedDay);
    setEnd(medication?.end_date || "");
    setActive(medication?.active ?? true);
    setNote(medication?.note || "");
  }, [open, medication, selectedDay]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      strength: strength || null,
      instructions: instructions || null,
      schedule_kind: kind,
      schedule_times: kind === "as_needed" ? [] : times.filter(Boolean),
      schedule_days: kind === "specific_days" ? days : [],
      start_date: start,
      end_date: end || null,
      active,
      note: note || null,
    };
    try {
      await api(
        medication ? `/api/medications/${medication.id}` : "/api/medications",
        {
          method: medication ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      toast.success(medication ? "Medication updated" : "Medication added");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {medication ? `Edit ${medication.name}` : "Add medication"}
            </DialogTitle>
            <DialogDescription>
              Rise only marks a dose when you explicitly record it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medication">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Strength">
              <Input
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="500 mg"
              />
            </Field>
            <Field label="Schedule">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="specific_days">
                    Selected weekdays
                  </SelectItem>
                  <SelectItem value="as_needed">As needed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date">
              <DatePicker
                aria-label="Medication start date"
                value={start}
                onChange={setStart}
              />
            </Field>
            {kind !== "as_needed" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Times</Label>
                {times.map((time, index) => (
                  <div key={index} className="flex gap-2">
                    <TimePicker
                      className="min-w-0 flex-1"
                      aria-label={`Medication time ${index + 1}`}
                      value={time}
                      onChange={(nextTime) =>
                        setTimes(
                          times.map((item, itemIndex) =>
                            itemIndex === index ? nextTime : item,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setTimes(
                          times.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      disabled={times.length === 1}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setTimes([...times, "12:00"])}
                >
                  <Plus />
                  Add time
                </Button>
              </div>
            )}
            {kind === "specific_days" && (
              <div className="sm:col-span-2">
                <Label>Weekdays</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (label, index) => (
                      <Button
                        key={label}
                        type="button"
                        size="sm"
                        variant={days.includes(index) ? "default" : "outline"}
                        onClick={() =>
                          setDays(
                            days.includes(index)
                              ? days.filter((day) => day !== index)
                              : [...days, index],
                          )
                        }
                      >
                        {label}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            )}
            <Field label="End date (optional)">
              <DatePicker
                aria-label="Medication end date"
                value={end}
                onChange={setEnd}
                min={start}
                allowClear
              />
            </Field>
            <Field label="Instructions">
              <Input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
            {medication && (
              <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium">Medication active</p>
                  <p className="text-xs text-muted-foreground">
                    Paused medication retains its history.
                  </p>
                </div>
                <Switch checked={active} onCheckedChange={setActive} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save medication</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DoseDialog({
  open,
  setOpen,
  medication,
  selectedDay,
  reload,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  medication: Medication;
  selectedDay: string;
  reload: () => Promise<void>;
}) {
  const [day, setDay] = useState(selectedDay);
  const [time, setTime] = useState("");
  const [status, setStatus] = useState("taken");
  const [dose, setDose] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setDay(selectedDay);
      setTime(currentTimeValue());
    }
  }, [open, selectedDay]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/medication-doses", {
        method: "POST",
        body: JSON.stringify({
          medication_id: medication.id,
          day,
          scheduled_time: null,
          observed_at: new Date(`${day}T${time}:00`).toISOString(),
          status,
          dose_text: dose || null,
          note: note || null,
        }),
      });
      toast.success("Dose recorded");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Log {medication.name}</DialogTitle>
            <DialogDescription>
              Add a dose you took outside the usual time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Day">
              <DatePicker
                aria-label="Dose day"
                max={localDateKey()}
                value={day}
                onChange={setDay}
              />
            </Field>
            <Field label="Time">
              <TimePicker
                aria-label="Dose time"
                value={time}
                onChange={setTime}
              />
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="taken">Taken</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Dose">
              <Input
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder={medication.strength || "Optional"}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save dose</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDialog({
  open,
  setOpen,
  appointment,
  reload,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  appointment: Appointment | null;
  reload: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [status, setStatus] = useState("scheduled");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setTitle(appointment?.title || "");
    setStartsAt(toDateTimeLocal(appointment?.starts_at || new Date()));
    setStatus(appointment?.status || "scheduled");
    setProvider(appointment?.provider || "");
    setLocation(appointment?.location || "");
    setNote(appointment?.note || "");
  }, [open, appointment]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(
        appointment
          ? `/api/appointments/${appointment.id}`
          : "/api/appointments",
        {
          method: appointment ? "PATCH" : "POST",
          body: JSON.stringify({
            title,
            starts_at: toIso(startsAt),
            status,
            provider: provider || null,
            location: location || null,
            note: note || null,
          }),
        },
      );
      toast.success(appointment ? "Appointment updated" : "Appointment added");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {appointment ? "Edit appointment" : "Add appointment"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Field label="Date & time">
              <DateTimePicker
                aria-label="Appointment date and time"
                value={startsAt}
                onChange={setStartsAt}
              />
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
            <Field label="Doctor or clinic">
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                />
              </Field>
              <Field label="Location">
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Note">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save appointment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReminderDialog({
  open,
  setOpen,
  reminder,
  appointments,
  reload,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  reminder: Reminder | null;
  appointments: Appointment[];
  reload: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState("pending");
  const [appointmentId, setAppointmentId] = useState("none");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 7);
    setTitle(reminder?.title || "");
    setDueAt(toDateTimeLocal(reminder?.due_at || defaultDue));
    setStatus(reminder?.status || "pending");
    setAppointmentId(reminder?.appointment_id || "none");
    setNote(reminder?.note || "");
  }, [open, reminder]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(reminder ? `/api/reminders/${reminder.id}` : "/api/reminders", {
        method: reminder ? "PATCH" : "POST",
        body: JSON.stringify({
          title,
          due_at: toIso(dueAt),
          status,
          appointment_id: appointmentId === "none" ? null : appointmentId,
          note: note || null,
        }),
      });
      toast.success(reminder ? "Reminder updated" : "Reminder added");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {reminder ? "Edit reminder" : "Add reminder"}
            </DialogTitle>
            <DialogDescription>
              Add something you do not want to forget.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Reminder">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Field label="Due">
              <DateTimePicker
                aria-label="Reminder due date and time"
                value={dueAt}
                onChange={setDueAt}
              />
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="For a visit">
              <Select value={appointmentId} onValueChange={setAppointmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {appointments.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save reminder</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
