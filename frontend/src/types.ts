export type WellnessEvent = {
  id: string;
  kind: "sleep" | "fasting" | "exercise" | "alcohol";
  started_at: string;
  ended_at?: string | null;
  title?: string | null;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  source?: string;
  source_text?: string | null;
};

export type Checkin = {
  day: string;
  fasting_minutes?: number | null;
  fasting_status?: "met" | "short" | "skipped" | null;
  activity_minutes?: number | null;
  activity_status?: "met" | "partial" | "skipped" | null;
  weight_kg?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse_bpm?: number | null;
  sleep_minutes?: number | null;
  bedtime?: string | null;
  wake_time?: string | null;
  rested?: "yes" | "somewhat" | "no" | null;
};

export type TodayItem = {
  key: string;
  active: boolean;
};

export type TrackerEntry = {
  id: string;
  day: string;
  occurrence_key?: string;
  observed_at?: string | null;
  updated_at?: string;
  value_text: string;
  numeric_value?: number | null;
  unit?: string | null;
  context?: string | null;
  note?: string | null;
  components?: Record<string, { numeric_value: number; value_text?: string; unit?: string }>;
};

export type Tracker = {
  id: string;
  key: string;
  name: string;
  category: string;
  value_type: "number" | "duration" | "choice" | "yes_no" | "time" | "blood_pressure";
  unit: string;
  frequency: "daily" | "anytime";
  input_min?: number | null;
  input_max?: number | null;
  input_step?: number | null;
  active: boolean;
  display_order: number;
  choices: string[];
  goal?: { label?: string | null; minimum?: number | null; maximum?: number | null };
  entries: TrackerEntry[];
};

export type HealthResult = {
  id: string;
  report_id: string;
  section?: string | null;
  name: string;
  canonical_key: string;
  value_text: string;
  numeric_value?: number | null;
  flag?: string | null;
  unit?: string | null;
  reference_range?: string | null;
  method?: string | null;
  detail?: string | null;
  sort_order?: number;
};

export type HealthHistoryPoint = {
  report_date: string;
  report_id: string;
  value_text: string;
  numeric_value?: number | null;
  flag?: string | null;
  unit?: string | null;
  reference_range?: string | null;
};

export type HealthReport = {
  id: string;
  report_date: string;
  title: string;
  category?: string | null;
  provider?: string | null;
  lab_number?: string | null;
  source_filenames: string[];
  detail?: string | null;
  results: HealthResult[];
};

export type MedicationDose = {
  id: string;
  scheduled_time?: string | null;
  observed_at: string;
  status: "taken" | "skipped";
  dose_text?: string | null;
  note?: string | null;
};

export type Medication = {
  id: string;
  name: string;
  strength?: string | null;
  instructions?: string | null;
  schedule_kind: "daily" | "specific_days" | "as_needed";
  schedule_times: string[];
  schedule_days: number[];
  start_date: string;
  end_date?: string | null;
  active: boolean;
  note?: string | null;
  scheduled_on_day: boolean;
  doses: MedicationDose[];
};

export type Appointment = {
  id: string;
  title: string;
  starts_at: string;
  status: "scheduled" | "completed" | "cancelled";
  provider?: string | null;
  location?: string | null;
  note?: string | null;
};

export type Reminder = {
  id: string;
  title: string;
  due_at: string;
  status: "pending" | "done" | "cancelled";
  appointment_id?: string | null;
  note?: string | null;
  overdue?: boolean;
};

export type CareData = {
  day: string;
  medications: Medication[];
  appointments: Appointment[];
  reminders: Reminder[];
  summary: {
    scheduled_doses?: number;
    recorded_doses?: number;
    pending_reminders?: number;
    overdue_reminders?: number;
  };
};

export type DashboardData = {
  events: WellnessEvent[];
  checkins: Checkin[];
  trackers: Tracker[];
  reports: HealthReport[];
  histories: Record<string, HealthHistoryPoint[]>;
  care: CareData;
  todayItems: TodayItem[];
};
