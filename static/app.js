const state = {
  days: 30,
  events: [],
  checkins: [],
  trackers: [],
  healthReports: [],
  healthHistories: {},
  healthDate: null,
  healthView: "trends",
  healthCategory: "all",
  healthShowAll: false,
  healthSearch: "",
  care: { medications: [], appointments: [], reminders: [], summary: {} },
  careDay: null,
  filter: "all",
  checkinDay: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  connection: $("#connectionStatus"),
  refresh: $("#refreshButton"),
  checkinDialog: $("#checkinDialog"),
  checkinDate: $("#checkinDate"),
  checkinStatus: $("#checkinStatus"),
  chart: $("#rhythmChart"),
  chartEmpty: $("#rhythmEmpty"),
  observations: $("#observations"),
  history: $("#historyList"),
  trackerList: $("#trackerList"),
  trackerEmpty: $("#trackerEmpty"),
  trackerCount: $("#trackerCount"),
  careDate: $("#careDate"),
  careSummary: $("#careSummary"),
  medicationList: $("#medicationList"),
  medicationEmpty: $("#medicationEmpty"),
  appointmentList: $("#appointmentList"),
  reminderList: $("#reminderList"),
  appointmentEmpty: $("#appointmentEmpty"),
  healthRecordList: $("#healthRecordList"),
  healthRecordEmpty: $("#healthRecordEmpty"),
  healthRecordDate: $("#healthRecordDate"),
  healthRecordSearch: $("#healthRecordSearch"),
  healthRecordCount: $("#healthRecordCount"),
  healthCategoryFilters: $("#healthCategoryFilters"),
  healthTrendSummary: $("#healthTrendSummary"),
  healthRecordDateLabel: $("#healthRecordDateLabel"),
  healthRecordNote: $("#healthRecordNote"),
  showAllHealthRecords: $("#showAllHealthRecords"),
  filter: $("#historyFilter"),
  dialog: $("#eventDialog"),
  form: $("#eventForm"),
  formError: $("#formError"),
  deleteEvent: $("#deleteEvent"),
  toast: $("#toast"),
};

const KIND_LABELS = {
  sleep: "Sleep",
  fasting: "Fast",
  exercise: "Exercise",
  alcohol: "Alcohol",
};

const RESTED_LABELS = {
  yes: "Rested",
  somewhat: "Okay",
  no: "Tired",
};

const HEALTH_CATEGORIES = [
  { id: "liver", label: "Liver", matches: (key) => ["alt", "ast"].includes(key) },
  { id: "blood_sugar", label: "Blood sugar", matches: (key) => key.startsWith("glucose_") || key === "hba1c" },
  { id: "lipids", label: "Cholesterol & fats", matches: (key) => key.startsWith("cholesterol_") || key.startsWith("triglycerides") },
  { id: "kidney", label: "Kidney", matches: (key) => key.startsWith("creatinine") || key === "egfr" || key.startsWith("urea") || key.startsWith("uric_acid") },
  { id: "inflammation", label: "Inflammation", matches: (key) => ["crp", "esr"].includes(key) },
  { id: "blood_count", label: "Blood count", matches: (key) => [
    "wbc", "rbc", "haemoglobin", "haematocrit", "mcv", "mch", "mchc", "platelets", "rdw",
    "neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils",
    "absolute_neutrophils", "absolute_lymphocytes", "absolute_monocytes", "absolute_eosinophils", "absolute_basophils",
  ].includes(key) },
  { id: "immune", label: "Immune markers", matches: (key) => ["rheumatoid_factor", "hla_b27", "anti_ccp"].includes(key) },
  { id: "minerals", label: "Minerals", matches: (key) => key.startsWith("calcium") },
  { id: "urine", label: "Urine", matches: (key) => key.startsWith("urine_") },
  { id: "body", label: "Body measurements", matches: (key) => key.startsWith("prescription_weight") || key.startsWith("prescription_height") || key.startsWith("prescription_bsa") },
];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function asDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(start, end) {
  const startDate = asDate(start);
  const endDate = asDate(end);
  if (!startDate || !endDate) return null;
  return Math.max(0, Math.round((endDate - startDate) / 60000));
}

function durationFor(event) {
  if (event.ended_at) return minutesBetween(event.started_at, event.ended_at);
  if (event.kind === "fasting") return minutesBetween(event.started_at, new Date().toISOString());
  if (event.kind === "exercise" && event.quantity != null && /min/i.test(event.unit || "")) {
    return Number(event.quantity);
  }
  return null;
}

function formatDuration(minutes, { compact = false } = {}) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "—";
  const rounded = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return compact ? `${hours}h` : `${hours} hr`;
  return `${hours}h ${remainder}m`;
}

function formatNumber(value) {
  const number = Number(value);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(1).replace(/\.0$/, "");
}

function formatDateTime(value) {
  const date = asDate(value);
  if (!date) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatClock(value) {
  const date = asDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : asDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputValue(value) {
  const date = asDate(value);
  if (!date) return "";
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}`;
}

function isoFromInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bedtimeIso(day, value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  const bedtime = new Date(`${day}T00:00:00`);
  if (hour >= 12) bedtime.setDate(bedtime.getDate() - 1);
  bedtime.setHours(hour, minute, 0, 0);
  return bedtime.toISOString();
}

function eventsOfKind(kind) {
  return state.events.filter((event) => event.kind === kind);
}

function sumDurations(events) {
  return events.reduce((sum, event) => sum + (durationFor(event) || 0), 0);
}

function checkinForDay(day) {
  return state.checkins.find((checkin) => checkin.day === day) || null;
}

function trackerByKey(key) {
  return state.trackers.find((tracker) => tracker.key === key) || null;
}

function trackerEntriesForDay(tracker, day) {
  return (tracker?.entries || []).filter((entry) => entry.day === day);
}

function latestTrackerEntryForDay(tracker, day) {
  return trackerEntriesForDay(tracker, day)[0] || null;
}

function effectiveDay(day) {
  const saved = checkinForDay(day) || {};
  const result = { ...saved, day };
  const bloodPressure = latestTrackerEntryForDay(trackerByKey("blood_pressure"), day);
  if (bloodPressure?.components?.systolic && bloodPressure?.components?.diastolic) {
    result.bp_systolic = bloodPressure.components.systolic.numeric_value;
    result.bp_diastolic = bloodPressure.components.diastolic.numeric_value;
    result.pulse_bpm = bloodPressure.components.pulse?.numeric_value ?? null;
    result.bp_reading_count = trackerEntriesForDay(trackerByKey("blood_pressure"), day).length;
  }

  if (result.sleep_minutes == null) {
    const sleeps = state.events.filter((event) => event.kind === "sleep" && event.ended_at && localDateKey(event.ended_at) === day);
    if (sleeps.length) result.sleep_minutes = sumDurations(sleeps);
  }
  if (result.fasting_minutes == null && result.fasting_status !== "skipped") {
    const fasts = state.events.filter((event) => event.kind === "fasting" && event.ended_at && localDateKey(event.started_at) === day);
    if (fasts.length) result.fasting_minutes = sumDurations(fasts);
  }
  if (result.activity_minutes == null && result.activity_status !== "skipped") {
    const activity = state.events.filter((event) => event.kind === "exercise" && localDateKey(event.started_at) === day);
    if (activity.length) result.activity_minutes = sumDurations(activity);
  }
  if (result.fasting_status == null && result.fasting_minutes != null) {
    result.fasting_status = Number(result.fasting_minutes) >= 1200 ? "met" : "short";
  }
  if (result.activity_status == null && result.activity_minutes != null) {
    result.activity_status = Number(result.activity_minutes) >= 60 ? "met" : "partial";
  }
  return result;
}

function hasDailyData(day) {
  return [
    day.fasting_minutes,
    day.fasting_status,
    day.activity_minutes,
    day.activity_status,
    day.weight_kg,
    day.bp_systolic,
    day.bp_diastolic,
    day.pulse_bpm,
    day.sleep_minutes,
    day.bedtime,
    day.wake_time,
    day.rested,
  ].some((value) => value !== null && value !== undefined && value !== "");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) elements.refresh.classList.add("loading");
  try {
    state.careDay ||= localDateKey(new Date());
    const [eventBody, checkinBody, trackerBody, healthRecordBody, careBody] = await Promise.all([
      api(`/api/events?days=${state.days}`),
      api(`/api/checkins?days=${state.days}`),
      api(`/api/trackers?days=${Math.max(state.days, 90)}&include_inactive=1`),
      api("/api/health-records"),
      api(`/api/care?day=${encodeURIComponent(state.careDay)}&include_inactive=1`),
    ]);
    state.events = eventBody.events || [];
    state.checkins = checkinBody.checkins || [];
    state.trackers = trackerBody.trackers || [];
    state.healthReports = healthRecordBody.reports || [];
    state.healthHistories = healthRecordBody.histories || {};
    state.care = careBody;
    if (!state.healthDate && state.healthReports.length) {
      state.healthDate = state.healthReports[0].report_date;
    }
    renderHealthRecordDateOptions();
    elements.connection.className = "connection online";
    elements.connection.lastElementChild.textContent = "Hermes data ready";
    render();
  } catch (error) {
    elements.connection.className = "connection offline";
    elements.connection.lastElementChild.textContent = "Dashboard unavailable";
    showToast(error.message, true);
  } finally {
    elements.refresh.classList.remove("loading");
  }
}

function render() {
  renderCheckin();
  renderSummary();
  renderRhythm();
  renderObservations();
  renderHistory();
  renderCare();
  renderTrackers();
  renderHealthRecords();
}

function renderCheckin() {
  const todayKey = localDateKey(new Date());
  const selectedDay = state.checkinDay || todayKey;
  const checkin = effectiveDay(selectedDay);
  state.checkinDay = selectedDay;

  elements.checkinDate.max = todayKey;
  if (document.activeElement !== elements.checkinDate) elements.checkinDate.value = selectedDay;
  $("#checkinDialogTitle").textContent = selectedDay === todayKey ? "Today" : formatDayLong(selectedDay);
  $("#checkinDateHint").textContent = selectedDay === todayKey
    ? "Today is selected. Choose an earlier date to fill a gap."
    : "You are adding or correcting a past day.";

  $$('[data-field]').forEach((button) => {
    const field = button.dataset.field;
    const value = button.dataset.value;
    let selected = false;
    if (field === "rested") selected = checkin.rested === value;
    if (field === "activity_status") selected = checkin.activity_status === "skipped";
    if (field === "fasting_status") selected = checkin.fasting_status === "skipped";
    if (field === "activity_minutes") selected = checkin.activity_status !== "skipped" && Number(checkin.activity_minutes) === Number(value);
    if (field === "fasting_minutes") selected = checkin.fasting_status !== "skipped" && Number(checkin.fasting_minutes) === Number(value);
    if (field === "sleep_minutes") selected = Number(checkin.sleep_minutes) === Number(value);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const bedtime = asDate(checkin.bedtime);
  const inputValues = {
    sleepHoursInput: checkin.sleep_minutes == null ? "" : Number(checkin.sleep_minutes) / 60,
    weightInput: checkin.weight_kg ?? "",
    bpSystolicInput: checkin.bp_systolic ?? "",
    bpDiastolicInput: checkin.bp_diastolic ?? "",
    pulseInput: checkin.pulse_bpm ?? "",
    activityInput: checkin.activity_status === "skipped" ? "" : (checkin.activity_minutes ?? ""),
    fastingInput: checkin.fasting_status === "skipped" || checkin.fasting_minutes == null ? "" : Number(checkin.fasting_minutes) / 60,
    bedtimeInput: bedtime ? `${String(bedtime.getHours()).padStart(2, "0")}:${String(bedtime.getMinutes()).padStart(2, "0")}` : "",
  };
  Object.entries(inputValues).forEach(([id, value]) => {
    const input = `#${id}`;
    const element = $(input);
    if (element && document.activeElement !== element) element.value = value;
  });
  renderCustomCheckin(selectedDay);
}

function renderSummary() {
  const todayKey = localDateKey(new Date());
  const today = effectiveDay(todayKey);
  const openFast = eventsOfKind("fasting").find((event) => !event.ended_at);

  if (today.fasting_status === "skipped") {
    $("#fastingValue").textContent = "Skipped";
    $("#fastingDetail").textContent = "Explicitly marked for today";
  } else if (today.fasting_minutes != null) {
    $("#fastingValue").textContent = formatDuration(today.fasting_minutes);
    $("#fastingDetail").textContent = Number(today.fasting_minutes) >= 1200 ? "Met the 20-hour standard" : "Below the 20-hour standard";
  } else if (openFast) {
    $("#fastingValue").textContent = "In progress";
    $("#fastingDetail").textContent = `${formatDuration(durationFor(openFast))} since ${formatClock(openFast.started_at)}`;
  } else {
    $("#fastingValue").textContent = "—";
    $("#fastingDetail").textContent = "Not logged today";
  }

  const latestWeight = state.checkins.find((checkin) => checkin.weight_kg != null);
  if (latestWeight) {
    $("#weightValue").textContent = `${formatNumber(latestWeight.weight_kg)} kg`;
    $("#weightDetail").textContent = latestWeight.day === todayKey ? "Logged today" : `Last logged ${formatDay(latestWeight.day)}`;
  } else {
    $("#weightValue").textContent = "—";
    $("#weightDetail").textContent = "No measurement yet";
  }

  if (today.bp_systolic != null && today.bp_diastolic != null) {
    $("#bpValue").textContent = `${today.bp_systolic}/${today.bp_diastolic}`;
    const readingCount = today.bp_reading_count || 1;
    const countLabel = `${readingCount} ${readingCount === 1 ? "reading" : "readings"} today`;
    $("#bpDetail").textContent = today.pulse_bpm != null
      ? `Pulse ${today.pulse_bpm} bpm · ${countLabel}`
      : countLabel;
  } else {
    $("#bpValue").textContent = "—";
    $("#bpDetail").textContent = "Not logged today";
  }

  if (today.activity_status === "skipped") {
    $("#exerciseValue").textContent = "Skipped";
    $("#exerciseDetail").textContent = "Explicitly marked for today";
  } else if (today.activity_minutes != null) {
    $("#exerciseValue").textContent = formatDuration(today.activity_minutes);
    $("#exerciseDetail").textContent = Number(today.activity_minutes) >= 60 ? "Met the 60-minute standard" : "Below the 60-minute standard";
  } else {
    $("#exerciseValue").textContent = "—";
    $("#exerciseDetail").textContent = "Not logged today";
  }

  if (today.sleep_minutes != null) {
    $("#sleepValue").textContent = formatDuration(today.sleep_minutes);
    const details = [];
    if (today.rested) details.push(RESTED_LABELS[today.rested]);
    if (today.bedtime) details.push(`bed ${formatClock(today.bedtime)}`);
    $("#sleepDetail").textContent = details.join(" · ") || "Logged this morning";
  } else if (today.rested) {
    $("#sleepValue").textContent = RESTED_LABELS[today.rested];
    $("#sleepDetail").textContent = today.bedtime ? `Bed ${formatClock(today.bedtime)}` : "Sleep hours not logged";
  } else {
    $("#sleepValue").textContent = "—";
    $("#sleepDetail").textContent = "Not logged this morning";
  }
}

function formatDay(day) {
  const date = new Date(`${day}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatDayLong(day) {
  const date = new Date(`${day}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildDayRows() {
  const count = Math.min(state.days, 14);
  const rows = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = localDateKey(date);
    rows.push({ date, key, data: effectiveDay(key) });
  }
  return rows;
}

function renderMetric(value, max, kind, label, status = null) {
  if (status === "skipped") return '<div class="metric-track skipped" title="Skipped"><span>Skipped</span></div>';
  if (value == null) return '<div class="metric-track empty"></div>';
  const amount = Math.max(0, Number(value));
  return `<div class="metric-track" title="${escapeHtml(label)}"><progress class="metric-progress ${kind}" max="${max}" value="${amount}"></progress><span class="metric-label">${escapeHtml(label)}</span></div>`;
}

function renderValueMetric(value, label, kind = "weight") {
  if (value == null) return '<div class="metric-track empty"></div>';
  return `<div class="metric-track value-only ${kind}"><span class="${kind}-value">${escapeHtml(label)}</span></div>`;
}

function renderRhythm() {
  const rows = buildDayRows();
  if (!rows.some(({ data }) => hasDailyData(data))) {
    elements.chart.innerHTML = "";
    elements.chart.classList.add("hidden");
    $(".rhythm-legend").classList.add("hidden");
    elements.chartEmpty.classList.remove("hidden");
    return;
  }
  elements.chart.classList.remove("hidden");
  $(".rhythm-legend").classList.remove("hidden");
  elements.chartEmpty.classList.add("hidden");
  elements.chart.innerHTML = rows.map(({ date, data }) => {
    const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    const number = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(date);
    return `
      <div class="rhythm-row">
        <div class="day-label"><strong>${number}</strong>${day}</div>
        ${renderMetric(data.sleep_minutes, 600, "sleep", formatDuration(data.sleep_minutes, { compact: true }))}
        ${renderMetric(data.fasting_minutes, 1200, "fasting", formatDuration(data.fasting_minutes, { compact: true }), data.fasting_status)}
        ${renderMetric(data.activity_minutes, 60, "exercise", formatDuration(data.activity_minutes, { compact: true }), data.activity_status)}
        ${renderValueMetric(data.weight_kg, `${formatNumber(data.weight_kg)} kg`)}
        ${renderValueMetric(
          data.bp_systolic != null && data.bp_diastolic != null ? data.bp_systolic : null,
          `${data.bp_systolic}/${data.bp_diastolic}`,
          "bp",
        )}
      </div>
    `;
  }).join("");
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function observation(mark, message, detail) {
  return `<div class="observation"><span class="observation-mark">${escapeHtml(mark)}</span><div><p>${escapeHtml(message)}</p><small>${escapeHtml(detail)}</small></div></div>`;
}

function renderObservations() {
  const dayKeys = new Set(state.checkins.map((checkin) => checkin.day));
  state.events.forEach((event) => dayKeys.add(localDateKey(event.started_at)));
  const days = [...dayKeys].map(effectiveDay).filter(hasDailyData);
  const fasts = days.filter((day) => day.fasting_status);
  const activity = days.filter((day) => day.activity_status);
  const sleepMinutes = days.map((day) => day.sleep_minutes).filter((value) => value != null).map(Number);
  const rested = days.filter((day) => day.rested);
  const bloodPressureDays = days.filter((day) => day.bp_systolic != null && day.bp_diastolic != null);
  const weights = [...state.checkins].filter((day) => day.weight_kg != null).sort((a, b) => a.day.localeCompare(b.day));
  const items = [];

  if (!days.length) {
    items.push(observation("1", "There is not enough information for an observation yet.", "Rise waits for your real entries."));
    items.push(observation("2", "Open the daily check-in or answer Hermes on Telegram.", "Missing days remain missing, never skipped."));
  } else {
    items.push(observation("·", `${days.length} of the last ${state.days} days contain at least one daily entry.`, "This describes coverage, not consistency."));
    if (fasts.length) {
      const met = fasts.filter((day) => day.fasting_status === "met").length;
      const skipped = fasts.filter((day) => day.fasting_status === "skipped").length;
      items.push(observation("F", `${met} of ${fasts.length} recorded fasting days met 20 hours.`, `${skipped} explicitly skipped; unlogged days are excluded.`));
    }
    if (activity.length) {
      const met = activity.filter((day) => day.activity_status === "met").length;
      const skipped = activity.filter((day) => day.activity_status === "skipped").length;
      items.push(observation("A", `${met} of ${activity.length} recorded activity days met 60 minutes.`, `${skipped} explicitly skipped; unlogged days are excluded.`));
    }
    if (sleepMinutes.length) {
      const restedCount = rested.filter((day) => day.rested === "yes").length;
      items.push(observation("S", `${sleepMinutes.length} recorded sleeps average ${formatDuration(average(sleepMinutes))}.`, `${restedCount} of ${rested.length} feeling entries were “Rested”.`));
    }
    if (bloodPressureDays.length) {
      items.push(observation("B", `Blood pressure was recorded on ${bloodPressureDays.length} ${bloodPressureDays.length === 1 ? "day" : "days"}.`, "Rise shows readings without interpreting them."));
    }
    if (weights.length >= 2) {
      const change = Number(weights.at(-1).weight_kg) - Number(weights[0].weight_kg);
      const direction = change === 0 ? "unchanged" : `${change > 0 ? "+" : ""}${formatNumber(change)} kg`;
      items.push(observation("W", `Recorded weight change: ${direction}.`, `${formatDay(weights[0].day)} to ${formatDay(weights.at(-1).day)}; no target is assumed.`));
    }
  }
  elements.observations.innerHTML = items.slice(0, 4).join("");
}

function formatRecordDate(day, { short = false } = {}) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(undefined, short
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "long", year: "numeric" }
  ).format(date);
}

function renderHealthRecordDateOptions() {
  if (!elements.healthRecordDate) return;
  const dates = [...new Set(state.healthReports.map((report) => report.report_date))];
  elements.healthRecordDate.innerHTML = dates
    .map((day) => `<option value="${escapeHtml(day)}">${escapeHtml(formatRecordDate(day))}</option>`)
    .join("");
  elements.healthRecordDate.value = state.healthDate || dates[0] || "";
}

function categoryForResult(result) {
  const key = result.canonical_key || "";
  return HEALTH_CATEGORIES.find((category) => category.matches(key)) || null;
}

function buildHealthTrendSeries() {
  const grouped = new Map();
  state.healthReports.forEach((report) => {
    if (state.healthDate && report.report_date > state.healthDate) return;
    report.results.forEach((result) => {
      const category = categoryForResult(result);
      if (!category) return;
      const seriesKey = `${result.canonical_key}\u001f${result.unit || ""}`;
      if (!grouped.has(seriesKey)) {
        grouped.set(seriesKey, {
          key: seriesKey,
          canonicalKey: result.canonical_key,
          unit: result.unit || "",
          category,
          points: [],
        });
      }
      grouped.get(seriesKey).points.push({
        ...result,
        reportDate: report.report_date,
        reportTitle: report.title,
      });
    });
  });
  return [...grouped.values()].map((series) => {
    series.points.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.id.localeCompare(b.id));
    const latest = series.points.at(-1);
    series.name = latest.name;
    series.latest = latest;
    return series;
  }).sort((a, b) => {
    const categoryOrder = HEALTH_CATEGORIES.findIndex((category) => category.id === a.category.id)
      - HEALTH_CATEGORIES.findIndex((category) => category.id === b.category.id);
    return categoryOrder || a.name.localeCompare(b.name);
  });
}

function resultDecimals(value) {
  const match = String(value ?? "").match(/^-?\d+\.(\d+)/);
  return match ? Math.min(3, match[1].length) : 0;
}

function formatTrendDifference(value, previous, latest) {
  const decimals = Math.max(resultDecimals(previous.value_text), resultDecimals(latest.value_text));
  return Math.abs(value).toFixed(decimals);
}

function changeBetween(previous, latest) {
  if (!previous) {
    return { kind: "first", label: "First result", detail: "No earlier result to compare" };
  }
  const previousNumeric = previous.numeric_value == null ? null : Number(previous.numeric_value);
  const latestNumeric = latest.numeric_value == null ? null : Number(latest.numeric_value);
  if (Number.isFinite(previousNumeric) && Number.isFinite(latestNumeric)) {
    const difference = latestNumeric - previousNumeric;
    if (Math.abs(difference) < 1e-12) {
      return { kind: "same", label: "No change", detail: `since ${formatRecordDate(previous.reportDate, { short: true })}` };
    }
    const kind = difference > 0 ? "up" : "down";
    const direction = difference > 0 ? "Up" : "Down";
    const percent = previousNumeric === 0 ? "" : ` · ${Math.abs((difference / previousNumeric) * 100).toFixed(1)}%`;
    return {
      kind,
      label: `${direction} ${formatTrendDifference(difference, previous, latest)}${latest.unit ? ` ${latest.unit}` : ""}`,
      detail: `${percent ? percent.slice(3) + " · " : ""}since ${formatRecordDate(previous.reportDate, { short: true })}`,
    };
  }
  if (String(previous.value_text).toLowerCase() === String(latest.value_text).toLowerCase()) {
    return { kind: "same", label: "No change", detail: `since ${formatRecordDate(previous.reportDate, { short: true })}` };
  }
  return {
    kind: "changed",
    label: "Changed",
    detail: `from ${previous.value_text} · ${formatRecordDate(previous.reportDate, { short: true })}`,
  };
}

function latestChange(series) {
  return changeBetween(series.points.at(-2), series.points.at(-1));
}

function renderTrendSparkline(series) {
  const points = series.points.filter((point) => point.numeric_value != null && Number.isFinite(Number(point.numeric_value)));
  if (points.length < 2) return "";
  const width = 260;
  const height = 66;
  const padding = 7;
  const values = points.map((point) => Number(point.numeric_value));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const coordinates = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = span === 0 ? height / 2 : height - padding - ((value - minimum) / span) * (height - padding * 2);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), point: points[index] };
  });
  return `
    <div class="trend-chart" aria-label="${escapeHtml(series.name)} values over time">
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <title>${escapeHtml(series.name)} trend from ${escapeHtml(points[0].value_text)} to ${escapeHtml(points.at(-1).value_text)} ${escapeHtml(series.unit)}</title>
        <path class="trend-chart-baseline" d="M${padding} ${height - padding}H${width - padding}" />
        <polyline points="${coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}" />
        ${coordinates.map(({ x, y, point }, index) => `<circle cx="${x}" cy="${y}" r="${index === coordinates.length - 1 ? 4 : 3}"><title>${escapeHtml(formatRecordDate(point.reportDate, { short: true }))}: ${escapeHtml(point.value_text)} ${escapeHtml(point.unit || "")}</title></circle>`).join("")}
      </svg>
      <div class="trend-chart-dates"><span>${escapeHtml(formatRecordDate(points[0].reportDate, { short: true }))}</span><span>${escapeHtml(formatRecordDate(points.at(-1).reportDate, { short: true }))}</span></div>
    </div>
  `;
}

function renderTrendHistory(series) {
  if (series.points.length < 2) return "";
  return `
    <details class="trend-history">
      <summary>View ${series.points.length} results</summary>
      <div class="trend-history-list">
        ${[...series.points].reverse().map((point, reverseIndex) => {
          const originalIndex = series.points.length - reverseIndex - 1;
          const change = changeBetween(originalIndex > 0 ? series.points[originalIndex - 1] : null, point);
          return `
            <div class="trend-history-row">
              <time datetime="${escapeHtml(point.reportDate)}">${escapeHtml(formatRecordDate(point.reportDate, { short: true }))}</time>
              <strong>${escapeHtml(point.value_text)}${point.unit ? ` <small>${escapeHtml(point.unit)}</small>` : ""}</strong>
              ${point.flag ? `<span class="result-flag ${point.flag === "L" ? "low" : "high"}">${escapeHtml(point.flag)}</span>` : `<span></span>`}
              <span class="history-change ${change.kind}">${escapeHtml(change.label)}</span>
            </div>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function renderTrendCard(series) {
  const latest = series.latest;
  const change = latestChange(series);
  const flagClass = latest.flag === "L" ? "low" : latest.flag ? "high" : "";
  return `
    <article class="metric-trend-card" data-category="${escapeHtml(series.category.id)}">
      <header>
        <span class="trend-category">${escapeHtml(series.category.label)}</span>
        <span class="trend-count">${series.points.length} ${series.points.length === 1 ? "result" : "results"}</span>
      </header>
      <h3>${escapeHtml(series.name)}</h3>
      <div class="trend-latest-row">
        <div class="trend-latest">
          <strong>${escapeHtml(latest.value_text)}</strong>
          ${latest.unit ? `<span>${escapeHtml(latest.unit)}</span>` : ""}
          ${latest.flag ? `<span class="result-flag ${flagClass}">${escapeHtml(latest.flag)}</span>` : ""}
        </div>
        <div class="trend-change ${change.kind}">
          <strong>${escapeHtml(change.label)}</strong>
          <small>${escapeHtml(change.detail)}</small>
        </div>
      </div>
      ${renderTrendSparkline(series)}
      <div class="trend-context">
        <time datetime="${escapeHtml(latest.reportDate)}">Latest · ${escapeHtml(formatRecordDate(latest.reportDate, { short: true }))}</time>
        ${latest.reference_range ? `<span>Source range · ${escapeHtml(latest.reference_range)}</span>` : ""}
      </div>
      ${latest.detail ? `<p class="result-detail">${escapeHtml(latest.detail)}</p>` : ""}
      ${renderTrendHistory(series)}
    </article>
  `;
}

function renderHealthCategoryFilters(series) {
  const counts = new Map();
  series.forEach((item) => counts.set(item.category.id, (counts.get(item.category.id) || 0) + 1));
  const categories = HEALTH_CATEGORIES.filter((category) => counts.has(category.id));
  elements.healthCategoryFilters.innerHTML = [
    `<button type="button" class="${state.healthCategory === "all" ? "active" : ""}" data-health-category="all">All <span>${series.length}</span></button>`,
    ...categories.map((category) => `<button type="button" class="${state.healthCategory === category.id ? "active" : ""}" data-health-category="${escapeHtml(category.id)}">${escapeHtml(category.label)} <span>${counts.get(category.id)}</span></button>`),
  ].join("");
}

function trendMatchesSearch(series) {
  if (!state.healthSearch) return true;
  return [
    series.name,
    series.category.label,
    series.unit,
    ...series.points.flatMap((point) => [point.value_text, point.flag, point.reference_range]),
  ].join(" ").toLowerCase().includes(state.healthSearch);
}

function renderTrendView() {
  const allSeries = buildHealthTrendSeries();
  renderHealthCategoryFilters(allSeries);
  const visible = allSeries.filter((series) => (
    (state.healthCategory === "all" || series.category.id === state.healthCategory)
    && trendMatchesSearch(series)
  ));
  const comparable = visible.filter((series) => series.points.length > 1);
  const changed = comparable.filter((series) => !["same", "first"].includes(latestChange(series).kind));
  const valueLabel = visible.length === 1 ? "value" : "values";
  elements.healthTrendSummary.innerHTML = `
    <div><strong>${visible.length}</strong><span>${valueLabel} tracked</span></div>
    <div><strong>${comparable.length}</strong><span>with a prior result</span></div>
    <div><strong>${changed.length}</strong><span>changed most recently</span></div>
  `;
  elements.healthRecordList.className = "health-record-list trend-grid";
  elements.healthRecordList.innerHTML = visible.map(renderTrendCard).join("");
  elements.healthRecordEmpty.classList.toggle("hidden", visible.length > 0);
  elements.healthRecordCount.textContent = `${visible.length} tracked ${valueLabel} · through ${formatRecordDate(state.healthDate, { short: true })}`;
}

function resultHistory(result) {
  const key = `${result.canonical_key}\u001f${result.unit || ""}`;
  return state.healthHistories[key] || [];
}

function renderResultHistory(result) {
  const history = resultHistory(result);
  if (history.length < 2) return "";
  return `
    <details class="result-history">
      <summary>History · ${history.length}</summary>
      <div class="result-history-list">
        ${history.map((item) => `
          <div>
            <time datetime="${escapeHtml(item.report_date)}">${escapeHtml(formatRecordDate(item.report_date, { short: true }))}</time>
            <span>${escapeHtml(item.value_text)}</span>
            ${item.flag ? `<strong class="result-flag ${item.flag === "L" ? "low" : "high"}">${escapeHtml(item.flag)}</strong>` : ""}
            <small>${escapeHtml(item.unit || "")}</small>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderHealthResult(result) {
  const flagClass = result.flag === "L" ? "low" : result.flag ? "high" : "";
  const searchable = [
    result.name,
    result.value_text,
    result.flag,
    result.unit,
    result.reference_range,
    result.section,
    result.detail,
  ].join(" ").toLowerCase();
  if (state.healthSearch && !searchable.includes(state.healthSearch)) return "";
  const spokenLine = [result.name, result.value_text, result.flag || "", result.unit || "", result.reference_range || ""].join(" - ");
  return `
    <div class="health-result" aria-label="${escapeHtml(spokenLine)}">
      <div class="health-result-main">
        <strong class="health-result-name">${escapeHtml(result.name)}</strong>
        <div class="health-result-facts" aria-hidden="true">
          <span class="health-result-value">${escapeHtml(result.value_text)}</span>
          ${result.flag ? `<span class="result-flag ${flagClass}">${escapeHtml(result.flag)}</span>` : ""}
          ${result.unit ? `<span>${escapeHtml(result.unit)}</span>` : ""}
          ${result.reference_range ? `<span class="result-range">${escapeHtml(result.reference_range)}</span>` : ""}
        </div>
        ${result.detail ? `<p class="result-detail">${escapeHtml(result.detail)}</p>` : ""}
      </div>
      ${renderResultHistory(result)}
    </div>
  `;
}

function renderHealthReport(report) {
  const sections = new Map();
  report.results.forEach((result) => {
    const rendered = renderHealthResult(result);
    if (!rendered) return;
    if (!sections.has(result.section)) sections.set(result.section, []);
    sections.get(result.section).push(rendered);
  });
  if (!sections.size) return "";
  const sourceLabel = `${report.source_filenames.length} source ${report.source_filenames.length === 1 ? "file" : "files"}`;
  return `
    <article class="health-report-card">
      <header class="health-report-header">
        <div>
          <time datetime="${escapeHtml(report.report_date)}">${escapeHtml(formatRecordDate(report.report_date))}</time>
          <h3>${escapeHtml(report.title)}</h3>
          <p>${escapeHtml(report.provider || "")}</p>
        </div>
        <span class="record-category">${escapeHtml(report.category)}</span>
      </header>
      ${report.detail ? `<p class="health-report-detail">${escapeHtml(report.detail)}</p>` : ""}
      <div class="health-result-sections">
        ${[...sections.entries()].map(([section, results]) => `
          <section class="health-result-section">
            <h4>${escapeHtml(section)}</h4>
            <div>${results.join("")}</div>
          </section>
        `).join("")}
      </div>
      <details class="record-sources">
        <summary>${sourceLabel}</summary>
        <ul>${report.source_filenames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
      </details>
    </article>
  `;
}

function renderReportView() {
  const dateReports = state.healthShowAll
    ? state.healthReports
    : state.healthReports.filter((report) => report.report_date === state.healthDate);
  const rendered = dateReports.map(renderHealthReport).filter(Boolean);
  const visibleResults = dateReports.reduce((total, report) => total + report.results.filter((result) => {
    if (!state.healthSearch) return true;
    return [result.name, result.value_text, result.flag, result.unit, result.reference_range, result.section, result.detail]
      .join(" ").toLowerCase().includes(state.healthSearch);
  }).length, 0);

  elements.healthRecordList.className = "health-record-list report-list";
  elements.healthRecordList.innerHTML = rendered.join("");
  elements.healthRecordEmpty.classList.toggle("hidden", rendered.length > 0);
  elements.healthRecordCount.textContent = `${rendered.length} ${rendered.length === 1 ? "report" : "reports"} · ${visibleResults} results${state.healthShowAll ? "" : ` · ${formatRecordDate(state.healthDate, { short: true })}`}`;
  elements.showAllHealthRecords.classList.toggle("active", state.healthShowAll);
  elements.showAllHealthRecords.textContent = state.healthShowAll ? "Latest date" : "All reports";
  elements.healthRecordDate.disabled = state.healthShowAll;
}

function renderHealthRecords() {
  if (!elements.healthRecordList) return;
  const isTrends = state.healthView === "trends";
  $$('[data-health-view]').forEach((button) => button.classList.toggle("active", button.dataset.healthView === state.healthView));
  elements.healthCategoryFilters.classList.toggle("hidden", !isTrends);
  elements.healthTrendSummary.classList.toggle("hidden", !isTrends);
  elements.showAllHealthRecords.classList.toggle("hidden", isTrends);
  elements.healthRecordDate.disabled = !isTrends && state.healthShowAll;
  elements.healthRecordDateLabel.textContent = isTrends ? "As of" : "Report date";
  elements.healthRecordSearch.placeholder = isTrends ? "Find a measurement" : "Find a test or result";
  elements.healthRecordNote.textContent = isTrends
    ? "Changes compare each result with its previous result in the same unit. Direction is factual, not a judgment of improvement or decline."
    : "Values, flags, units and reference ranges are shown as written in the source reports. Rise does not interpret them.";
  if (isTrends) renderTrendView();
  else renderReportView();
}

function careScheduleLabel(medication) {
  if (medication.schedule_kind === "as_needed") return "As needed";
  const times = medication.schedule_times.map((time) => formatClock(`${state.careDay}T${time}:00`)).join(" · ");
  if (medication.schedule_kind === "daily") return `Daily · ${times}`;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `${medication.schedule_days.map((day) => dayNames[day]).join(", ")} · ${times}`;
}

function doseForSlot(medication, time) {
  return (medication.doses || []).find((dose) => dose.scheduled_time === time) || null;
}

function renderMedicationCard(medication) {
  const paused = !medication.active;
  const scheduled = medication.scheduled_on_day && medication.schedule_kind !== "as_needed";
  let actions = "";
  if (paused) {
    actions = '<p class="care-card-note">Paused</p>';
  } else if (medication.schedule_kind === "as_needed") {
    actions = `<button type="button" class="care-primary-action" data-log-dose="${escapeHtml(medication.id)}">Log dose</button>`;
  } else if (!scheduled) {
    actions = '<p class="care-card-note">Not scheduled for this day</p>';
  } else {
    actions = `<div class="dose-slots">${medication.schedule_times.map((time) => {
      const dose = doseForSlot(medication, time);
      return `<div class="dose-slot${dose ? ` ${escapeHtml(dose.status)}` : ""}">
        <div><strong>${escapeHtml(formatClock(`${state.careDay}T${time}:00`))}</strong><small>${dose ? (dose.status === "taken" ? "Taken" : "Skipped") : "Not logged"}</small></div>
        <div class="dose-actions">
          <button type="button" class="${dose?.status === "taken" ? "selected" : ""}" data-dose-medication="${escapeHtml(medication.id)}" data-dose-time="${escapeHtml(time)}" data-dose-status="taken">Taken</button>
          <button type="button" class="${dose?.status === "skipped" ? "selected" : ""}" data-dose-medication="${escapeHtml(medication.id)}" data-dose-time="${escapeHtml(time)}" data-dose-status="skipped">Skip</button>
        </div>
      </div>`;
    }).join("")}</div>`;
  }
  const unscheduledDoses = (medication.doses || []).filter((dose) => !dose.scheduled_time);
  return `<article class="care-card medication-card${paused ? " paused" : ""}">
    <header><div><span class="care-kicker">${escapeHtml(careScheduleLabel(medication))}</span><h4>${escapeHtml(medication.name)}${medication.strength ? ` <small>${escapeHtml(medication.strength)}</small>` : ""}</h4></div><button type="button" class="text-button" data-edit-medication="${escapeHtml(medication.id)}">Edit</button></header>
    ${medication.instructions ? `<p>${escapeHtml(medication.instructions)}</p>` : ""}
    ${actions}
    ${unscheduledDoses.length ? `<div class="care-log-history">${unscheduledDoses.map((dose) => `<span>${escapeHtml(formatClock(dose.observed_at))} · ${dose.status === "taken" ? "Taken" : "Skipped"}${dose.dose_text ? ` · ${escapeHtml(dose.dose_text)}` : ""}</span>`).join("")}</div>` : ""}
  </article>`;
}

function renderAppointmentCard(appointment) {
  return `<article class="care-card appointment-card ${escapeHtml(appointment.status)}">
    <header><div><span class="care-kicker">${escapeHtml(formatDateTime(appointment.starts_at))}</span><h4>${escapeHtml(appointment.title)}</h4></div><button type="button" class="text-button" data-edit-appointment="${escapeHtml(appointment.id)}">Edit</button></header>
    <p>${[appointment.provider, appointment.location].filter(Boolean).map(escapeHtml).join(" · ") || "No provider or location added"}</p>
    <span class="care-status ${escapeHtml(appointment.status)}">${escapeHtml(appointment.status)}</span>
  </article>`;
}

function renderReminderCard(reminder) {
  const due = reminder.overdue ? "Overdue" : `Due ${formatDateTime(reminder.due_at)}`;
  return `<article class="care-card reminder-card${reminder.overdue ? " overdue" : ""}">
    <header><div><span class="care-kicker">${escapeHtml(due)}</span><h4>${escapeHtml(reminder.title)}</h4></div><button type="button" class="text-button" data-edit-reminder="${escapeHtml(reminder.id)}">Edit</button></header>
    ${reminder.note ? `<p>${escapeHtml(reminder.note)}</p>` : ""}
    ${reminder.status === "pending" ? `<button type="button" class="care-primary-action" data-complete-reminder="${escapeHtml(reminder.id)}">Done</button>` : `<span class="care-status ${escapeHtml(reminder.status)}">${escapeHtml(reminder.status)}</span>`}
  </article>`;
}

function renderCare() {
  if (!elements.medicationList) return;
  const medications = state.care.medications || [];
  const appointments = state.care.appointments || [];
  const reminders = state.care.reminders || [];
  const summary = state.care.summary || {};
  elements.careDate.value = state.careDay;
  elements.careDate.max = "9999-12-31";
  const doseSummary = summary.scheduled_doses
    ? `${summary.recorded_doses || 0} of ${summary.scheduled_doses} scheduled doses logged`
    : "No scheduled doses for this day";
  const reminderSummary = summary.pending_reminders
    ? ` · ${summary.pending_reminders} follow-up ${summary.pending_reminders === 1 ? "reminder" : "reminders"}`
    : "";
  elements.careSummary.textContent = `${doseSummary}${reminderSummary}`;
  elements.medicationList.innerHTML = medications.map(renderMedicationCard).join("");
  elements.medicationEmpty.classList.toggle("hidden", medications.length > 0);
  elements.appointmentList.innerHTML = appointments.map(renderAppointmentCard).join("");
  elements.reminderList.innerHTML = reminders.map(renderReminderCard).join("");
  elements.appointmentEmpty.classList.toggle("hidden", appointments.length + reminders.length > 0);
}

async function loadCare() {
  state.care = await api(`/api/care?day=${encodeURIComponent(state.careDay)}&include_inactive=1`);
  renderCare();
}

function renderMedicationTimeInputs(times = ["08:00"]) {
  const values = times.length ? times : ["08:00"];
  $("#medicationTimes").innerHTML = values.map((time, index) => `<div class="medication-time-row"><input type="time" value="${escapeHtml(time)}" required aria-label="Medication time ${index + 1}"><button type="button" class="icon-button" data-remove-medication-time aria-label="Remove time">×</button></div>`).join("");
}

function syncMedicationScheduleFields() {
  const kind = $("#medicationScheduleKind").value;
  $("#medicationScheduleFields").classList.toggle("hidden", kind === "as_needed");
  $("#medicationWeekdays").classList.toggle("hidden", kind !== "specific_days");
  $$("#medicationTimes input").forEach((input) => { input.required = kind !== "as_needed"; });
}

function openMedicationDialog(medication = null) {
  $("#medicationForm").reset();
  $("#medicationFormError").classList.add("hidden");
  $("#medicationId").value = medication?.id || "";
  $("#medicationName").value = medication?.name || "";
  $("#medicationStrength").value = medication?.strength || "";
  $("#medicationInstructions").value = medication?.instructions || "";
  $("#medicationScheduleKind").value = medication?.schedule_kind || "daily";
  $("#medicationStartDate").value = medication?.start_date || state.careDay;
  $("#medicationEndDate").value = medication?.end_date || "";
  $("#medicationActive").checked = medication?.active ?? true;
  $("#medicationNote").value = medication?.note || "";
  renderMedicationTimeInputs(medication?.schedule_times || ["08:00"]);
  $$("#medicationWeekdays input").forEach((input) => { input.checked = (medication?.schedule_days || []).includes(Number(input.value)); });
  $("#medicationDialogTitle").textContent = medication ? `Edit ${medication.name}` : "Add medication";
  syncMedicationScheduleFields();
  $("#medicationDialog").showModal();
  document.body.classList.add("modal-open");
}

async function saveMedication(event) {
  event.preventDefault();
  const error = $("#medicationFormError");
  error.classList.add("hidden");
  const id = $("#medicationId").value;
  const kind = $("#medicationScheduleKind").value;
  const payload = {
    name: $("#medicationName").value,
    strength: $("#medicationStrength").value || null,
    instructions: $("#medicationInstructions").value || null,
    schedule_kind: kind,
    schedule_times: kind === "as_needed" ? [] : $$("#medicationTimes input").map((input) => input.value).filter(Boolean),
    schedule_days: kind === "specific_days" ? $$("#medicationWeekdays input:checked").map((input) => Number(input.value)) : [],
    start_date: $("#medicationStartDate").value,
    end_date: $("#medicationEndDate").value || null,
    active: $("#medicationActive").checked,
    note: $("#medicationNote").value || null,
  };
  try {
    await api(id ? `/api/medications/${id}` : "/api/medications", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    $("#medicationDialog").close();
    document.body.classList.remove("modal-open");
    await loadCare();
    showToast(id ? "Medication updated" : "Medication added");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  }
}

function openDoseDialog(medication, scheduledTime = "") {
  $("#doseForm").reset();
  $("#doseFormError").classList.add("hidden");
  $("#doseMedicationId").value = medication.id;
  $("#doseScheduledTime").value = scheduledTime;
  $("#doseDay").value = state.careDay;
  const now = new Date();
  $("#doseObservedTime").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  $("#doseDialogTitle").textContent = `Log ${medication.name}`;
  $("#doseDialog").showModal();
  document.body.classList.add("modal-open");
}

async function saveDosePayload(payload) {
  await api("/api/medication-doses", { method: "POST", body: JSON.stringify(payload) });
  await loadCare();
  showToast(payload.status === "taken" ? "Dose marked taken" : "Dose marked skipped");
}

async function saveScheduledDose(medicationId, scheduledTime, status) {
  try {
    await saveDosePayload({ medication_id: medicationId, day: state.careDay, scheduled_time: scheduledTime, observed_at: new Date().toISOString(), status });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveDose(event) {
  event.preventDefault();
  const error = $("#doseFormError");
  error.classList.add("hidden");
  const day = $("#doseDay").value;
  const time = $("#doseObservedTime").value;
  try {
    await saveDosePayload({
      medication_id: $("#doseMedicationId").value,
      day,
      scheduled_time: $("#doseScheduledTime").value || null,
      observed_at: new Date(`${day}T${time}:00`).toISOString(),
      status: $("#doseStatus").value,
      dose_text: $("#doseText").value || null,
      note: $("#doseNote").value || null,
    });
    $("#doseDialog").close();
    document.body.classList.remove("modal-open");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  }
}

function openAppointmentDialog(appointment = null) {
  $("#appointmentForm").reset();
  $("#appointmentFormError").classList.add("hidden");
  $("#appointmentId").value = appointment?.id || "";
  $("#appointmentTitle").value = appointment?.title || "";
  $("#appointmentStartsAt").value = dateInputValue(appointment?.starts_at || new Date());
  $("#appointmentStatus").value = appointment?.status || "scheduled";
  $("#appointmentProvider").value = appointment?.provider || "";
  $("#appointmentLocation").value = appointment?.location || "";
  $("#appointmentNote").value = appointment?.note || "";
  $("#appointmentDialogTitle").textContent = appointment ? "Edit appointment" : "Add appointment";
  $("#appointmentDialog").showModal();
  document.body.classList.add("modal-open");
}

async function saveAppointment(event) {
  event.preventDefault();
  const error = $("#appointmentFormError");
  error.classList.add("hidden");
  const id = $("#appointmentId").value;
  try {
    await api(id ? `/api/appointments/${id}` : "/api/appointments", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ title: $("#appointmentTitle").value, starts_at: isoFromInput($("#appointmentStartsAt").value), status: $("#appointmentStatus").value, provider: $("#appointmentProvider").value || null, location: $("#appointmentLocation").value || null, note: $("#appointmentNote").value || null }),
    });
    $("#appointmentDialog").close();
    document.body.classList.remove("modal-open");
    await loadCare();
    showToast(id ? "Appointment updated" : "Appointment added");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  }
}

function openReminderDialog(reminder = null) {
  $("#reminderForm").reset();
  $("#reminderFormError").classList.add("hidden");
  $("#reminderId").value = reminder?.id || "";
  $("#reminderTitle").value = reminder?.title || "";
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  $("#reminderDueAt").value = dateInputValue(reminder?.due_at || defaultDue);
  $("#reminderStatus").value = reminder?.status || "pending";
  $("#reminderNote").value = reminder?.note || "";
  $("#reminderAppointmentId").innerHTML = `<option value="">None</option>${(state.care.appointments || []).map((appointment) => `<option value="${escapeHtml(appointment.id)}">${escapeHtml(appointment.title)} · ${escapeHtml(formatDateTime(appointment.starts_at))}</option>`).join("")}`;
  $("#reminderAppointmentId").value = reminder?.appointment_id || "";
  $("#reminderDialogTitle").textContent = reminder ? "Edit reminder" : "Add reminder";
  $("#reminderDialog").showModal();
  document.body.classList.add("modal-open");
}

async function saveReminder(event) {
  event.preventDefault();
  const error = $("#reminderFormError");
  error.classList.add("hidden");
  const id = $("#reminderId").value;
  try {
    await api(id ? `/api/reminders/${id}` : "/api/reminders", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ title: $("#reminderTitle").value, due_at: isoFromInput($("#reminderDueAt").value), status: $("#reminderStatus").value, appointment_id: $("#reminderAppointmentId").value || null, note: $("#reminderNote").value || null }),
    });
    $("#reminderDialog").close();
    document.body.classList.remove("modal-open");
    await loadCare();
    showToast(id ? "Reminder updated" : "Reminder added");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  }
}

function trackerEntriesAscending(tracker) {
  return [...(tracker.entries || [])].sort((a, b) => (
    a.day.localeCompare(b.day)
    || String(a.observed_at || a.updated_at).localeCompare(String(b.observed_at || b.updated_at))
    || a.id.localeCompare(b.id)
  ));
}

function sortTrackerEntriesDescending(entries) {
  entries.sort((a, b) => (
    b.day.localeCompare(a.day)
    || String(b.observed_at || b.updated_at).localeCompare(String(a.observed_at || a.updated_at))
    || b.id.localeCompare(a.id)
  ));
}

function trackerEntryPrimaryNumber(tracker, entry) {
  if (tracker.value_type === "blood_pressure") {
    return entry.components?.systolic?.numeric_value ?? null;
  }
  return entry.numeric_value;
}

function trackerEntryDisplay(tracker, entry) {
  if (!entry) return "—";
  if (tracker.value_type === "blood_pressure") {
    const systolic = entry.components?.systolic?.numeric_value;
    const diastolic = entry.components?.diastolic?.numeric_value;
    return systolic != null && diastolic != null ? `${systolic}/${diastolic}` : entry.value_text;
  }
  return `${entry.value_text}${entry.unit ? ` ${entry.unit}` : ""}`;
}

function trackerEntryWhen(entry) {
  if (entry.observed_at) return formatDateTime(entry.observed_at);
  return formatRecordDate(entry.day, { short: true });
}

function signedTrackerDifference(value, previous, latest) {
  if (Math.abs(value) < 1e-12) return "0";
  const absolute = formatTrendDifference(value, previous, latest);
  return `${value > 0 ? "+" : "−"}${absolute}`;
}

function trackerLatestChange(tracker) {
  const points = trackerEntriesAscending(tracker);
  const latest = points.at(-1);
  const previous = points.at(-2);
  if (!latest || !previous) return { kind: "first", label: "First result", detail: "No earlier result" };
  if (tracker.value_type === "blood_pressure") {
    const currentSystolic = Number(latest.components?.systolic?.numeric_value);
    const previousSystolic = Number(previous.components?.systolic?.numeric_value);
    const currentDiastolic = Number(latest.components?.diastolic?.numeric_value);
    const previousDiastolic = Number(previous.components?.diastolic?.numeric_value);
    if ([currentSystolic, previousSystolic, currentDiastolic, previousDiastolic].every(Number.isFinite)) {
      const systolicChange = currentSystolic - previousSystolic;
      const diastolicChange = currentDiastolic - previousDiastolic;
      return {
        kind: Math.abs(systolicChange) < 1e-12 && Math.abs(diastolicChange) < 1e-12 ? "same" : "changed",
        label: `S ${signedTrackerDifference(systolicChange, previous, latest)} · D ${signedTrackerDifference(diastolicChange, previous, latest)}`,
        detail: `since ${trackerEntryWhen(previous)}`,
      };
    }
  }
  const current = trackerEntryPrimaryNumber(tracker, latest);
  const prior = trackerEntryPrimaryNumber(tracker, previous);
  if (current != null && prior != null && Number.isFinite(Number(current)) && Number.isFinite(Number(prior))) {
    const difference = Number(current) - Number(prior);
    if (Math.abs(difference) < 1e-12) return { kind: "same", label: "No change", detail: `since ${trackerEntryWhen(previous)}` };
    return {
      kind: difference > 0 ? "up" : "down",
      label: `${difference > 0 ? "Up" : "Down"} ${formatTrendDifference(difference, previous, latest)}${tracker.unit ? ` ${tracker.unit}` : ""}`,
      detail: `since ${trackerEntryWhen(previous)}`,
    };
  }
  const same = String(latest.value_text).toLowerCase() === String(previous.value_text).toLowerCase();
  return { kind: same ? "same" : "changed", label: same ? "No change" : "Changed", detail: `since ${trackerEntryWhen(previous)}` };
}

function trackerSparklineCoordinates(values, width, height, padding, minimum, span) {
  return values.map((value, index) => ({
    x: Number((padding + (index / (values.length - 1)) * (width - padding * 2)).toFixed(1)),
    y: Number((span === 0 ? height / 2 : height - padding - ((value - minimum) / span) * (height - padding * 2)).toFixed(1)),
  }));
}

function renderTrackerSparkline(tracker) {
  const entries = trackerEntriesAscending(tracker);
  if (entries.length < 2) return "";
  const series = tracker.value_type === "blood_pressure"
    ? [
      { className: "primary", values: entries.map((entry) => Number(entry.components?.systolic?.numeric_value)) },
      { className: "secondary", values: entries.map((entry) => Number(entry.components?.diastolic?.numeric_value)) },
    ]
    : [{ className: "primary", values: entries.map((entry) => Number(entry.numeric_value)) }];
  if (series.some((item) => item.values.some((value) => !Number.isFinite(value)))) return "";
  const allValues = series.flatMap((item) => item.values);
  const minimum = Math.min(...allValues);
  const maximum = Math.max(...allValues);
  const span = maximum - minimum;
  const width = 260;
  const height = 66;
  const padding = 7;
  return `
    <div class="tracker-chart" aria-label="${escapeHtml(tracker.name)} values over time">
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <title>${escapeHtml(tracker.name)} trend</title>
        <path class="tracker-chart-baseline" d="M${padding} ${height - padding}H${width - padding}" />
        ${series.map((item) => {
          const coordinates = trackerSparklineCoordinates(item.values, width, height, padding, minimum, span);
          return `<polyline class="${item.className}" points="${coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}" />`;
        }).join("")}
      </svg>
      <div class="trend-chart-dates"><span>${escapeHtml(trackerEntryWhen(entries[0]))}</span><span>${escapeHtml(trackerEntryWhen(entries.at(-1)))}</span></div>
    </div>
  `;
}

function renderTrackerHistory(tracker) {
  const entries = tracker.entries || [];
  if (!entries.length) return "";
  return `
    <details class="trend-history tracker-history">
      <summary>View ${entries.length} ${entries.length === 1 ? "reading" : "readings"}</summary>
      <div class="trend-history-list">
        ${entries.slice(0, 12).map((entry) => {
          const pulse = entry.components?.pulse?.numeric_value;
          return `
            <div class="tracker-history-row">
              <time datetime="${escapeHtml(entry.observed_at || entry.day)}">${escapeHtml(trackerEntryWhen(entry))}</time>
              <strong>${escapeHtml(trackerEntryDisplay(tracker, entry))}</strong>
              ${pulse != null ? `<span>Pulse ${escapeHtml(pulse)} bpm</span>` : `<span>${escapeHtml(entry.context || "")}</span>`}
            </div>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function renderTrackerCard(tracker) {
  const latest = tracker.entries?.[0] || null;
  const change = trackerLatestChange(tracker);
  const frequency = tracker.frequency === "daily" ? "Once daily" : "Multiple readings";
  const goal = tracker.goal?.label || (
    tracker.goal?.minimum != null || tracker.goal?.maximum != null
      ? `Reference ${tracker.goal.minimum ?? "—"}–${tracker.goal.maximum ?? "—"}${tracker.unit ? ` ${tracker.unit}` : ""}`
      : ""
  );
  return `
    <article class="tracker-card${tracker.active ? "" : " paused"}" data-tracker-id="${escapeHtml(tracker.id)}">
      <header>
        <div><span class="tracker-category">${escapeHtml(tracker.category)}${tracker.active ? "" : " · Paused"}</span><h3>${escapeHtml(tracker.name)}</h3></div>
        <button type="button" class="tracker-edit-button" data-edit-tracker="${escapeHtml(tracker.id)}" aria-label="Edit ${escapeHtml(tracker.name)}">Edit</button>
      </header>
      <div class="tracker-latest-row">
        <div class="tracker-latest">
          <strong>${escapeHtml(trackerEntryDisplay(tracker, latest))}</strong>
          <span>${latest ? `Latest · ${escapeHtml(trackerEntryWhen(latest))}` : "No readings yet"}</span>
        </div>
        ${latest ? `<div class="trend-change ${change.kind}"><strong>${escapeHtml(change.label)}</strong><small>${escapeHtml(change.detail)}</small></div>` : ""}
      </div>
      ${renderTrackerSparkline(tracker)}
      <div class="tracker-card-meta"><span>${frequency}</span>${goal ? `<span>${escapeHtml(goal)}</span>` : ""}</div>
      ${tracker.active
        ? `<button type="button" class="tracker-log-button" data-log-tracker="${escapeHtml(tracker.id)}">Log ${escapeHtml(tracker.name)}</button>`
        : `<button type="button" class="tracker-log-button" data-edit-tracker="${escapeHtml(tracker.id)}">Resume tracker</button>`}
      ${renderTrackerHistory(tracker)}
    </article>
  `;
}

function renderTrackers() {
  if (!elements.trackerList) return;
  const trackers = state.trackers;
  const activeCount = trackers.filter((tracker) => tracker.active).length;
  elements.trackerList.innerHTML = trackers.map(renderTrackerCard).join("");
  elements.trackerEmpty.classList.toggle("hidden", trackers.length > 0);
  elements.trackerCount.textContent = `${activeCount} active ${activeCount === 1 ? "tracker" : "trackers"}`;
}

function trackerInputAttributes(tracker) {
  return [
    tracker.input_min != null ? `min="${escapeHtml(tracker.input_min)}"` : "",
    tracker.input_max != null ? `max="${escapeHtml(tracker.input_max)}"` : "",
    `step="${escapeHtml(tracker.input_step ?? "any")}"`,
  ].filter(Boolean).join(" ");
}

function renderCustomCheckin(day) {
  const trackers = state.trackers.filter((tracker) => (
    tracker.active && tracker.frequency === "daily" && tracker.value_type !== "blood_pressure"
  ));
  const group = $("#customCheckinGroup");
  const fields = $("#customCheckinFields");
  group.classList.toggle("hidden", trackers.length === 0);
  fields.innerHTML = trackers.map((tracker) => {
    const entry = latestTrackerEntryForDay(tracker, day);
    if (["choice", "yes_no"].includes(tracker.value_type)) {
      return `
        <div class="question-block custom-tracker-question">
          <p>${escapeHtml(tracker.name)}${tracker.unit ? ` <em>${escapeHtml(tracker.unit)}</em>` : ""}</p>
          <div class="choice-row">${tracker.choices.map((choice) => `<button type="button" class="${entry?.value_text === choice ? "selected" : ""}" data-custom-choice="${escapeHtml(tracker.id)}" data-value="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join("")}</div>
        </div>
      `;
    }
    const inputType = tracker.value_type === "time" ? "time" : "number";
    return `
      <div class="question-block custom-tracker-question">
        <p>${escapeHtml(tracker.name)}${tracker.unit ? ` <em>${escapeHtml(tracker.unit)}</em>` : ""}</p>
        <div class="inline-log">
          <input id="custom-${escapeHtml(tracker.id)}" type="${inputType}" ${inputType === "number" ? `${trackerInputAttributes(tracker)} inputmode="decimal"` : ""} value="${escapeHtml(entry?.value_text || "")}" aria-label="${escapeHtml(tracker.name)}">
          <button type="button" data-custom-log="${escapeHtml(tracker.id)}">Log</button>
        </div>
      </div>
    `;
  }).join("");
  $$('[data-custom-choice]').forEach((button) => button.addEventListener("click", () => {
    const tracker = state.trackers.find((item) => item.id === button.dataset.customChoice);
    saveTrackerValue(tracker, button.dataset.value, day, { fromCheckin: true }).catch(() => {});
  }));
  $$('[data-custom-log]').forEach((button) => button.addEventListener("click", () => {
    const tracker = state.trackers.find((item) => item.id === button.dataset.customLog);
    const input = $(`#custom-${tracker.id}`);
    if (!input.reportValidity() || !input.value) return;
    saveTrackerValue(tracker, input.value, day, { fromCheckin: true }).catch(() => {});
  }));
}

async function saveTrackerValue(tracker, value, day, { observedAt = null, context = null, note = null, fromCheckin = false } = {}) {
  if (!tracker) return;
  if (fromCheckin) setCheckinStatus("Saving…", "saving");
  try {
    const body = await api("/api/tracker-entries", {
      method: "POST",
      body: JSON.stringify({ tracker_id: tracker.id, day, observed_at: observedAt, value, context, note }),
    });
    if (tracker.frequency === "daily") {
      tracker.entries = (tracker.entries || []).filter((entry) => !(entry.day === day && entry.occurrence_key === "daily"));
    }
    tracker.entries = [body.entry, ...(tracker.entries || [])];
    sortTrackerEntriesDescending(tracker.entries);
    renderCheckin();
    renderSummary();
    renderRhythm();
    renderObservations();
    renderTrackers();
    if (fromCheckin) setCheckinStatus("Saved just now", "saved");
    showToast(`${tracker.name} recorded`);
    return body.entry;
  } catch (error) {
    if (fromCheckin) setCheckinStatus("Could not save", "error");
    showToast(error.message, true);
    throw error;
  }
}

function syncTrackerFormOptions() {
  const valueType = $("#trackerValueType").value;
  const numeric = ["number", "duration"].includes(valueType);
  $("#trackerNumberOptions").classList.toggle("hidden", !numeric);
  $("#trackerRangeOptions").classList.toggle("hidden", !numeric);
  $("#trackerChoicesLabel").classList.toggle("hidden", valueType !== "choice");
  $("#trackerUnit").required = valueType === "duration";
}

function openTrackerDialog(tracker = null) {
  const form = $("#trackerForm");
  form.reset();
  $("#trackerFormError").classList.add("hidden");
  $("#trackerId").value = tracker?.id || "";
  $("#trackerName").value = tracker?.name || "";
  $("#trackerCategory").value = tracker?.category || "";
  $("#trackerValueType").value = tracker?.value_type || "number";
  $("#trackerFrequency").value = tracker?.frequency || "daily";
  $("#trackerUnit").value = tracker?.unit || "";
  $("#trackerStep").value = tracker?.input_step ?? "";
  $("#trackerMinimum").value = tracker?.input_min ?? "";
  $("#trackerMaximum").value = tracker?.input_max ?? "";
  $("#trackerChoices").value = tracker?.choices?.join(", ") || "";
  $("#trackerGoalLabel").value = tracker?.goal?.label || "";
  $("#trackerGoalMinimum").value = tracker?.goal?.minimum ?? "";
  $("#trackerGoalMaximum").value = tracker?.goal?.maximum ?? "";
  $("#trackerActive").checked = tracker?.active ?? true;
  $("#trackerDialogTitle").textContent = tracker ? `Edit ${tracker.name}` : "Create a tracker";
  $("#saveTrackerButton").textContent = tracker ? "Save changes" : "Create tracker";
  $("#trackerActiveLabel").classList.toggle("hidden", !tracker);
  $("#trackerValueType").disabled = Boolean(tracker?.entries?.length);
  $("#trackerFrequency").disabled = Boolean(tracker?.entries?.length);
  $("#trackerUnit").disabled = Boolean(tracker?.entries?.length);
  syncTrackerFormOptions();
  $("#trackerDialog").showModal();
  document.body.classList.add("modal-open");
}

function closeTrackerDialog() {
  $("#trackerDialog").close();
  document.body.classList.remove("modal-open");
}

function optionalFormNumber(id) {
  const value = $(id).value;
  return value === "" ? null : Number(value);
}

async function saveTrackerDefinition(event) {
  event.preventDefault();
  const error = $("#trackerFormError");
  error.classList.add("hidden");
  const trackerId = $("#trackerId").value;
  const choices = $("#trackerChoices").value.split(",").map((item) => item.trim()).filter(Boolean);
  const goal = {
    label: $("#trackerGoalLabel").value || null,
    minimum: optionalFormNumber("#trackerGoalMinimum"),
    maximum: optionalFormNumber("#trackerGoalMaximum"),
  };
  const payload = {
    name: $("#trackerName").value,
    category: $("#trackerCategory").value || "Personal",
    value_type: $("#trackerValueType").value,
    frequency: $("#trackerFrequency").value,
    unit: $("#trackerUnit").value,
    input_step: optionalFormNumber("#trackerStep"),
    input_min: optionalFormNumber("#trackerMinimum"),
    input_max: optionalFormNumber("#trackerMaximum"),
    choices,
    goal,
    active: $("#trackerActive").checked,
  };
  try {
    $("#saveTrackerButton").disabled = true;
    const body = await api(trackerId ? `/api/trackers/${trackerId}` : "/api/trackers", {
      method: trackerId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    const index = state.trackers.findIndex((tracker) => tracker.id === body.tracker.id);
    const existingEntries = index >= 0 ? state.trackers[index].entries : [];
    body.tracker.entries = existingEntries;
    if (index >= 0) state.trackers[index] = body.tracker;
    else state.trackers.push(body.tracker);
    state.trackers.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    closeTrackerDialog();
    render();
    showToast(trackerId ? "Tracker updated" : "Tracker created");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  } finally {
    $("#saveTrackerButton").disabled = false;
  }
}

function trackerEntryValueHtml(tracker) {
  if (tracker.value_type === "blood_pressure") {
    return `
      <div class="bp-log tracker-entry-bp">
        <label><span>Systolic</span><input id="trackerEntrySystolic" type="number" min="40" max="300" step="1" inputmode="numeric" required></label>
        <label><span>Diastolic</span><input id="trackerEntryDiastolic" type="number" min="20" max="200" step="1" inputmode="numeric" required></label>
        <label><span>Pulse <small>optional</small></span><input id="trackerEntryPulse" type="number" min="20" max="250" step="1" inputmode="numeric"></label>
      </div>
    `;
  }
  if (["choice", "yes_no"].includes(tracker.value_type)) {
    return `<label class="full-field"><span>Value</span><select id="trackerEntryValue" required><option value="">Choose…</option>${tracker.choices.map((choice) => `<option value="${escapeHtml(choice)}">${escapeHtml(choice)}</option>`).join("")}</select></label>`;
  }
  if (tracker.value_type === "time") {
    return `<label class="full-field"><span>Value</span><input id="trackerEntryValue" type="time" required></label>`;
  }
  return `<label class="full-field"><span>Value${tracker.unit ? ` <small>${escapeHtml(tracker.unit)}</small>` : ""}</span><input id="trackerEntryValue" type="number" ${trackerInputAttributes(tracker)} inputmode="decimal" required></label>`;
}

function openTrackerEntryDialog(tracker, day = localDateKey(new Date())) {
  if (!tracker) return;
  $("#trackerEntryForm").reset();
  $("#trackerEntryError").classList.add("hidden");
  $("#trackerEntryTrackerId").value = tracker.id;
  $("#trackerEntryCategory").textContent = tracker.category;
  $("#trackerEntryTitle").textContent = `Log ${tracker.name}`;
  $("#trackerEntryDay").value = day;
  $("#trackerEntryDay").max = localDateKey(new Date());
  const now = new Date();
  $("#trackerObservedAt").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  $("#trackerObservedAtLabel").classList.toggle("hidden", tracker.frequency === "daily");
  $("#trackerEntryValueField").innerHTML = trackerEntryValueHtml(tracker);
  $("#trackerEntryDialog").showModal();
  document.body.classList.add("modal-open");
}

function closeTrackerEntryDialog() {
  $("#trackerEntryDialog").close();
  document.body.classList.remove("modal-open");
}

function trackerEntryFormValue(tracker) {
  if (tracker.value_type === "blood_pressure") {
    const value = {
      systolic: Number($("#trackerEntrySystolic").value),
      diastolic: Number($("#trackerEntryDiastolic").value),
    };
    if ($("#trackerEntryPulse").value) value.pulse = Number($("#trackerEntryPulse").value);
    return value;
  }
  return $("#trackerEntryValue").value;
}

async function saveTrackerEntryForm(event) {
  event.preventDefault();
  const tracker = state.trackers.find((item) => item.id === $("#trackerEntryTrackerId").value);
  const day = $("#trackerEntryDay").value;
  const time = $("#trackerObservedAt").value;
  const observedAt = tracker.frequency === "anytime" && time
    ? new Date(`${day}T${time}:00`).toISOString()
    : null;
  const error = $("#trackerEntryError");
  error.classList.add("hidden");
  try {
    $("#saveTrackerEntryButton").disabled = true;
    await saveTrackerValue(tracker, trackerEntryFormValue(tracker), day, {
      observedAt,
      context: $("#trackerEntryContext").value || null,
      note: $("#trackerEntryNote").value || null,
    });
    closeTrackerEntryDialog();
  } catch (saveError) {
    error.textContent = saveError.message;
    error.classList.remove("hidden");
  } finally {
    $("#saveTrackerEntryButton").disabled = false;
  }
}

function eventTitle(event) {
  if (event.title) return event.title;
  if (event.kind === "sleep" || event.kind === "fasting") {
    const duration = durationFor(event);
    return `${KIND_LABELS[event.kind]}${duration != null ? ` · ${formatDuration(duration)}` : " started"}`;
  }
  if (event.quantity != null) return `${KIND_LABELS[event.kind]} · ${formatNumber(event.quantity)} ${event.unit || ""}`.trim();
  return KIND_LABELS[event.kind] || "Wellness entry";
}

function renderHistory() {
  const filtered = state.filter === "all" ? state.events : state.events.filter((event) => event.kind === state.filter);
  if (!filtered.length) {
    elements.history.innerHTML = `<p class="history-empty">${state.events.length ? "No entries match this filter." : "No detailed entries yet. Daily answers appear in the rhythm above."}</p>`;
    return;
  }
  elements.history.innerHTML = filtered.slice(0, 8).map((event) => `
    <button class="history-entry" type="button" data-event-id="${event.id}" aria-label="Edit ${escapeHtml(eventTitle(event))}">
      <span class="entry-dot ${event.kind}" aria-hidden="true"></span>
      <span class="entry-copy"><span class="entry-title">${escapeHtml(eventTitle(event))}</span><span class="entry-source">${escapeHtml(event.source_text || event.note || (event.source === "hermes" ? "Recorded by Hermes" : "Added in Rise"))}</span></span>
      <span class="entry-time">${escapeHtml(formatDateTime(event.started_at))}</span>
    </button>
  `).join("");
  $$('[data-event-id]').forEach((button) => button.addEventListener("click", () => openDialog(state.events.find((event) => event.id === button.dataset.eventId))));
}

function setCheckinStatus(message, stateName = "idle") {
  elements.checkinStatus.lastChild.textContent = message;
  elements.checkinStatus.dataset.state = stateName;
}

async function saveCheckin(payload, successMessage) {
  const day = state.checkinDay || localDateKey(new Date());
  setCheckinStatus("Saving…", "saving");
  try {
    const body = await api(`/api/checkins/${day}`, { method: "PUT", body: JSON.stringify(payload) });
    const index = state.checkins.findIndex((checkin) => checkin.day === day);
    if (index >= 0) state.checkins[index] = body.checkin;
    else state.checkins.unshift(body.checkin);
    state.checkins.sort((a, b) => b.day.localeCompare(a.day));
    renderCheckin();
    renderSummary();
    renderRhythm();
    renderObservations();
    setCheckinStatus("Saved just now", "saved");
    showToast(successMessage);
  } catch (error) {
    setCheckinStatus("Could not save", "error");
    showToast(error.message, true);
  }
}

function openCheckinDialog(day = localDateKey(new Date())) {
  const today = localDateKey(new Date());
  state.checkinDay = day && day <= today ? day : today;
  setCheckinStatus("Saves as you tap", "idle");
  renderCheckin();
  elements.checkinDialog.showModal();
  document.body.classList.add("modal-open");
}

function closeCheckinDialog() {
  elements.checkinDialog.close();
  document.body.classList.remove("modal-open");
}

function bindCheckin() {
  $("#openCheckinButton").addEventListener("click", () => openCheckinDialog());
  $("#closeCheckinButton").addEventListener("click", closeCheckinDialog);
  $("#doneCheckinButton").addEventListener("click", closeCheckinDialog);
  elements.checkinDialog.addEventListener("close", () => document.body.classList.remove("modal-open"));
  elements.checkinDialog.addEventListener("click", (event) => {
    if (event.target === elements.checkinDialog) closeCheckinDialog();
  });
  elements.checkinDate.addEventListener("change", () => {
    const today = localDateKey(new Date());
    if (!elements.checkinDate.value || elements.checkinDate.value > today) {
      elements.checkinDate.value = today;
    }
    state.checkinDay = elements.checkinDate.value;
    setCheckinStatus("Saves as you tap", "idle");
    renderCheckin();
  });

  $$('[data-field]').forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.field;
      const rawValue = button.dataset.value;
      const payload = { [field]: field.endsWith("_minutes") ? Number(rawValue) : rawValue };
      if (field === "activity_status") payload.activity_minutes = 0;
      if (field === "fasting_status") payload.fasting_minutes = 0;
      saveCheckin(payload, `${button.textContent.trim()} recorded`);
    });
  });

  $$('[data-log-input]').forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(`#${button.dataset.logInput}`);
      if (!input.reportValidity() || input.value === "") return;
      const field = button.dataset.inputField;
      const value = field === "bedtime" ? bedtimeIso(state.checkinDay, input.value) : Number(input.value) * Number(button.dataset.multiplier || 1);
      if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
        showToast("Enter a valid value", true);
        return;
      }
      const label = field === "weight_kg" ? "Weight" : field === "bedtime" ? "Bedtime" : "Actual";
      saveCheckin({ [field]: value }, `${label} recorded`);
    });
  });

  $("#logBloodPressure").addEventListener("click", () => {
    const systolic = $("#bpSystolicInput");
    const diastolic = $("#bpDiastolicInput");
    const pulse = $("#pulseInput");
    if (!systolic.reportValidity() || !diastolic.reportValidity() || !pulse.reportValidity()) return;
    if (!systolic.value || !diastolic.value) {
      showToast("Enter both blood pressure numbers", true);
      return;
    }
    const value = {
      systolic: Number(systolic.value),
      diastolic: Number(diastolic.value),
    };
    if (pulse.value) value.pulse = Number(pulse.value);
    const day = state.checkinDay || localDateKey(new Date());
    const observedAt = day === localDateKey(new Date()) ? new Date().toISOString() : null;
    saveTrackerValue(trackerByKey("blood_pressure"), value, day, { observedAt, fromCheckin: true }).catch(() => {});
  });

  $$('.inline-log input').forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.nextElementSibling.click();
      }
    });
  });
}

function openDialog(event = null) {
  elements.form.reset();
  elements.formError.classList.add("hidden");
  $("#eventId").value = event?.id || "";
  $("#eventKind").value = event?.kind || "sleep";
  $("#eventTitle").value = event?.title || "";
  $("#eventStart").value = dateInputValue(event?.started_at || new Date());
  $("#eventEnd").value = dateInputValue(event?.ended_at);
  $("#eventQuantity").value = event?.quantity ?? "";
  $("#eventUnit").value = event?.unit || "";
  $("#eventNote").value = event?.note || "";
  $("#dialogEyebrow").textContent = event ? "Correct entry" : "Manual entry";
  $("#dialogTitle").textContent = event ? "Edit what was recorded" : "Add what happened";
  elements.deleteEvent.classList.toggle("hidden", !event);
  elements.dialog.showModal();
}

function closeDialog() {
  elements.dialog.close();
}

async function saveEvent(event) {
  event.preventDefault();
  elements.formError.classList.add("hidden");
  const id = $("#eventId").value;
  const payload = {
    kind: $("#eventKind").value,
    title: $("#eventTitle").value || null,
    started_at: isoFromInput($("#eventStart").value),
    ended_at: isoFromInput($("#eventEnd").value),
    quantity: $("#eventQuantity").value || null,
    unit: $("#eventUnit").value || null,
    note: $("#eventNote").value || null,
  };
  if (!id) payload.source = "manual";
  try {
    $("#saveEvent").disabled = true;
    await api(id ? `/api/events/${id}` : "/api/events", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    closeDialog();
    showToast(id ? "Entry updated" : "Entry added");
    await loadData({ quiet: true });
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.classList.remove("hidden");
  } finally {
    $("#saveEvent").disabled = false;
  }
}

async function deleteCurrentEvent() {
  const id = $("#eventId").value;
  if (!id || !window.confirm("Delete this entry? This cannot be undone.")) return;
  try {
    await api(`/api/events/${id}`, { method: "DELETE" });
    closeDialog();
    showToast("Entry deleted");
    await loadData({ quiet: true });
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.classList.remove("hidden");
  }
}

let toastTimer;
function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 3200);
}

function bindEvents() {
  $$('[data-days]').forEach((button) => {
    button.addEventListener("click", async () => {
      state.days = Number(button.dataset.days);
      $$('[data-days]').forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      await loadData();
    });
  });
  elements.refresh.addEventListener("click", () => loadData());
  elements.filter.addEventListener("change", () => {
    state.filter = elements.filter.value;
    renderHistory();
  });
  elements.healthRecordDate.addEventListener("change", () => {
    state.healthDate = elements.healthRecordDate.value;
    state.healthShowAll = false;
    renderHealthRecords();
  });
  $$('[data-health-view]').forEach((button) => {
    button.addEventListener("click", () => {
      state.healthView = button.dataset.healthView;
      state.healthShowAll = false;
      renderHealthRecords();
    });
  });
  elements.healthCategoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-health-category]");
    if (!button) return;
    state.healthCategory = button.dataset.healthCategory;
    renderHealthRecords();
  });
  elements.showAllHealthRecords.addEventListener("click", () => {
    state.healthShowAll = !state.healthShowAll;
    renderHealthRecords();
  });
  elements.healthRecordSearch.addEventListener("input", () => {
    state.healthSearch = elements.healthRecordSearch.value.trim().toLowerCase();
    renderHealthRecords();
  });

  elements.careDate.addEventListener("change", async () => {
    if (!elements.careDate.value) return;
    state.careDay = elements.careDate.value;
    try {
      await loadCare();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#addMedicationButton").addEventListener("click", () => openMedicationDialog());
  $("#addAppointmentButton").addEventListener("click", () => openAppointmentDialog());
  $("#addReminderButton").addEventListener("click", () => openReminderDialog());
  elements.medicationList.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-medication]");
    const log = event.target.closest("[data-log-dose]");
    const slot = event.target.closest("[data-dose-medication]");
    if (edit) openMedicationDialog(state.care.medications.find((item) => item.id === edit.dataset.editMedication));
    if (log) openDoseDialog(state.care.medications.find((item) => item.id === log.dataset.logDose));
    if (slot) saveScheduledDose(slot.dataset.doseMedication, slot.dataset.doseTime, slot.dataset.doseStatus);
  });
  elements.appointmentList.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-appointment]");
    if (edit) openAppointmentDialog(state.care.appointments.find((item) => item.id === edit.dataset.editAppointment));
  });
  elements.reminderList.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-reminder]");
    const complete = event.target.closest("[data-complete-reminder]");
    if (edit) openReminderDialog(state.care.reminders.find((item) => item.id === edit.dataset.editReminder));
    if (complete) {
      try {
        await api(`/api/reminders/${complete.dataset.completeReminder}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
        await loadCare();
        showToast("Follow-up marked done");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });
  $("#medicationScheduleKind").addEventListener("change", syncMedicationScheduleFields);
  $("#addMedicationTime").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "medication-time-row";
    row.innerHTML = '<input type="time" required aria-label="Medication time"><button type="button" class="icon-button" data-remove-medication-time aria-label="Remove time">×</button>';
    $("#medicationTimes").append(row);
  });
  $("#medicationTimes").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-medication-time]");
    if (remove && $$("#medicationTimes .medication-time-row").length > 1) remove.closest(".medication-time-row").remove();
  });
  $("#medicationForm").addEventListener("submit", saveMedication);
  $("#doseForm").addEventListener("submit", saveDose);
  $("#appointmentForm").addEventListener("submit", saveAppointment);
  $("#reminderForm").addEventListener("submit", saveReminder);
  [
    ["medicationDialog", "closeMedicationDialog", "cancelMedicationDialog"],
    ["doseDialog", "closeDoseDialog", "cancelDoseDialog"],
    ["appointmentDialog", "closeAppointmentDialog", "cancelAppointmentDialog"],
    ["reminderDialog", "closeReminderDialog", "cancelReminderDialog"],
  ].forEach(([dialogId, closeId, cancelId]) => {
    const dialog = $(`#${dialogId}`);
    const close = () => { dialog.close(); document.body.classList.remove("modal-open"); };
    $(`#${closeId}`).addEventListener("click", close);
    $(`#${cancelId}`).addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener("close", () => document.body.classList.remove("modal-open"));
  });

  const openNewTracker = () => openTrackerDialog();
  $("#addTrackerButton").addEventListener("click", openNewTracker);
  $("#addFirstTrackerButton").addEventListener("click", openNewTracker);
  elements.trackerList.addEventListener("click", (event) => {
    const logButton = event.target.closest("[data-log-tracker]");
    const editButton = event.target.closest("[data-edit-tracker]");
    if (logButton) {
      openTrackerEntryDialog(state.trackers.find((tracker) => tracker.id === logButton.dataset.logTracker));
    } else if (editButton) {
      openTrackerDialog(state.trackers.find((tracker) => tracker.id === editButton.dataset.editTracker));
    }
  });
  $("#trackerValueType").addEventListener("change", syncTrackerFormOptions);
  $("#trackerForm").addEventListener("submit", saveTrackerDefinition);
  $("#closeTrackerDialog").addEventListener("click", closeTrackerDialog);
  $("#cancelTrackerDialog").addEventListener("click", closeTrackerDialog);
  $("#trackerDialog").addEventListener("click", (event) => {
    if (event.target === $("#trackerDialog")) closeTrackerDialog();
  });
  $("#trackerEntryForm").addEventListener("submit", saveTrackerEntryForm);
  $("#closeTrackerEntryDialog").addEventListener("click", closeTrackerEntryDialog);
  $("#cancelTrackerEntryDialog").addEventListener("click", closeTrackerEntryDialog);
  $("#trackerEntryDialog").addEventListener("click", (event) => {
    if (event.target === $("#trackerEntryDialog")) closeTrackerEntryDialog();
  });
  $("#addEntryButton").addEventListener("click", () => openDialog());
  $("#closeDialog").addEventListener("click", closeDialog);
  $("#cancelDialog").addEventListener("click", closeDialog);
  elements.deleteEvent.addEventListener("click", deleteCurrentEvent);
  elements.form.addEventListener("submit", saveEvent);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
}

function start() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  bindCheckin();
  bindEvents();
  loadData();
  if (window.location.hash === "#checkin") {
    window.setTimeout(() => openCheckinDialog(), 0);
  }
  window.setInterval(() => {
    if (eventsOfKind("fasting").some((event) => !event.ended_at)) renderSummary();
  }, 60000);
}

start();
