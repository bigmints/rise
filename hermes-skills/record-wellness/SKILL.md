---
name: record-wellness
description: "Record explicit wellness and care updates in Rise from Telegram: fasting, sleep, rested feeling, activity, alcohol, weight, blood pressure, configurable measurements, medications, doses, appointments, and follow-up reminders. Use for free-text updates, corrections, repeated readings, daily check-ins, medication or appointment changes, and questions about what Rise can track. Discover live tracker definitions and care IDs before writing. Never infer skipped routines, missed doses, diagnoses, or medical advice."
---

# Record Wellness in Rise

Use `scripts/record_event.py` from this skill directory for chat-originated reads and writes. Use the deterministic check-in and reminder scripts only for their scheduled jobs.

## Intent routing

1. Record a wellness fact only when the user says it happened.
2. Create or update a care record only when the user explicitly asks.
3. Treat a request to be reminded to book a follow-up as a `reminder`, not an `appointment`.
4. Treat plans such as “I will walk later” as plans, not completed activity.
5. Answer general questions without writing anything.

Use Asia/Dubai for relative dates. “Today” means the current Dubai calendar day; resolve “yesterday” before calling the script. Use timezone-aware ISO 8601 timestamps such as `2026-08-18T20:15:00+04:00`.

## Safe write workflow

1. Preserve the user's exact original wording in `--source-text`.
2. Ask one short question only when a required value is missing or multiple live records match.
3. Build a stable idempotency key from the Telegram update/message ID plus a per-record suffix, for example `telegram-128:bp-1`.
4. Reuse that key only for an identical retry. Use a new suffix for a correction, edited value, or separate reading.
5. Run the command once. Claim success only when it exits successfully and Rise returns the saved day, record, or ID.
6. If Rise rejects the write, say it was not recorded and include the short error. Do not silently retry with invented values.

Keep distinct blood-pressure, blood-sugar, symptom, and as-needed-dose observations as separate records, even on the same day. Never average or merge them.

## Daily check-ins

Morning check-in choices:

- Rested: `yes`, `somewhat`, or `no`
- Sleep: actual hours; bedtime and wake time only if supplied
- Weight and blood pressure: optional; blood pressure may have multiple readings

Evening check-in choices:

- Activity: actual minutes or explicit skip; 60 minutes is the standard, not an assumed result
- Fasting: actual hours or explicit skip; 20:4 is the standard, not an assumed result

The scheduled Telegram buttons are sent by `scripts/send_checkin.py`. Exact values open Rise's check-in modal. Do not mark an unanswered question as skipped.

```bash
python3 scripts/record_event.py sleep-checkin --day 2026-08-18 --hours 7.5 --rested somewhat --bedtime "2026-08-17T23:30:00+04:00" --wake-time "2026-08-18T07:00:00+04:00" --source-text "Slept 7.5 hours, feel okay"
python3 scripts/record_event.py activity --day 2026-08-18 --minutes 45 --source-text "45 minutes activity today"
python3 scripts/record_event.py activity --day 2026-08-18 --skipped --source-text "Skipped activity today"
python3 scripts/record_event.py fasting-day --day 2026-08-18 --hours 18.5 --source-text "Fasted 18.5 hours"
python3 scripts/record_event.py fasting-day --day 2026-08-18 --skipped --source-text "Skipped fasting today"
python3 scripts/record_event.py weight --day 2026-08-18 --kg 82.4 --source-text "82.4 kg this morning"
```

For detailed periods or alcohol, use `fast-start`, `fast-end`, `sleep`, `exercise`, or `alcohol`. Run `python3 scripts/record_event.py COMMAND --help` for exact fields. Do not close a fast until the user says it ended. Do not turn vague alcohol quantities into numbers.

## Blood pressure and configurable trackers

Blood pressure is always a repeated-capable tracker. Include the observation time when known and give every reading its own idempotency key.

```bash
python3 scripts/record_event.py blood-pressure --day 2026-08-18 --at "2026-08-18T20:15:00+04:00" --systolic 118 --diastolic 76 --pulse 68 --idempotency-key "telegram-123:bp-1" --source-text "BP 118/76, pulse 68"
```

For any other measurement, discover the live definition first. Never guess a key, unit, value type, choice, range, or frequency.

```bash
python3 scripts/record_event.py list-trackers
python3 scripts/record_event.py tracker --key blood_sugar --day 2026-08-18 --value 104 --at "2026-08-18T07:45:00+04:00" --context "before breakfast" --idempotency-key "telegram-124:sugar-1" --source-text "Blood sugar 104 before breakfast"
```

If the requested tracker does not exist, say it is not configured and ask the user to create it in Rise. Do not change code or substitute another tracker.

## Medications and doses

Run `list-care` before matching a medication by name. Use only an exact unambiguous returned ID.

```bash
python3 scripts/record_event.py list-care --day 2026-08-18
python3 scripts/record_event.py medication --name "Metformin" --strength "500 mg" --instructions "With food" --schedule-kind daily --time 08:00 --time 20:00 --start-date 2026-08-18 --idempotency-key "telegram-125:medication-1" --source-text "Add Metformin 500 mg with food at 8 AM and 8 PM"
python3 scripts/record_event.py medication --name "Vitamin D" --strength "1000 IU" --schedule-kind specific_days --weekday 0 --weekday 4 --time 09:00 --start-date 2026-08-18 --idempotency-key "telegram-126:medication-1" --source-text "Vitamin D Monday and Friday at 9"
python3 scripts/record_event.py medication --name "Pain relief" --schedule-kind as_needed --start-date 2026-08-18 --idempotency-key "telegram-127:medication-1" --source-text "Add pain relief as needed"
```

Weekdays are Monday `0` through Sunday `6`. Use `--scheduled-time` only for a scheduled slot. Record each scheduled or as-needed dose separately.

```bash
python3 scripts/record_event.py dose --medication-id MEDICATION_ID --day 2026-08-18 --scheduled-time 20:00 --at "2026-08-18T20:07:00+04:00" --status taken --dose-text "500 mg" --idempotency-key "telegram-128:dose-1" --source-text "Took my evening Metformin"
python3 scripts/record_event.py dose --medication-id MEDICATION_ID --day 2026-08-18 --at "2026-08-18T15:10:00+04:00" --status taken --idempotency-key "telegram-129:dose-1" --source-text "Took pain relief now"
```

Never infer that an unlogged scheduled dose was missed or skipped. Never recommend a dose or schedule.

## Appointments and follow-up reminders

Run `list-care` before linking a reminder or changing a status. Appointments and reminders have independent statuses.

```bash
python3 scripts/record_event.py appointment --title "Rheumatology follow-up" --provider "Dr Ahmed" --location "City Clinic" --starts-at "2026-08-25T10:00:00+04:00" --idempotency-key "telegram-130:appointment-1" --source-text "Rheumatology follow-up with Dr Ahmed on August 25 at 10"
python3 scripts/record_event.py reminder --title "Book blood test follow-up" --due-at "2026-08-20T09:00:00+04:00" --appointment-id APPOINTMENT_ID --idempotency-key "telegram-131:reminder-1" --source-text "Remind me August 20 to book blood test follow-up"
python3 scripts/record_event.py appointment-status --appointment-id APPOINTMENT_ID --status completed --idempotency-key "telegram-132:appointment-status-1" --source-text "That appointment is complete"
python3 scripts/record_event.py reminder-status --reminder-id REMINDER_ID --status done --idempotency-key "telegram-133:reminder-status-1" --source-text "I booked the follow-up"
```

Use `scripts/send_care_reminders.py` only for deterministic scheduled delivery. It sends due follow-ups and upcoming appointments; it must not send missed-dose prompts.

## Boundaries

- Do not diagnose, score, moralize, or add medical advice.
- Do not invent a tracker, medication, unit, schedule, provider, appointment, reminder, target, status, date, time, or value.
- Do not expose tokens, signed quick-check-in URLs, internal IDs, or environment contents in chat. IDs may be used internally in commands.
- Do not say “logged” or “recorded” before Rise acknowledges the write.
- Keep replies brief: confirm what was saved and the effective date/time; mention a correction or explicit skip when relevant.

Scripts read `RISE_API_URL` and `RISE_HERMES_TOKEN`. The API URL defaults to `http://127.0.0.1:8787`.
