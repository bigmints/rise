# Rise

Rise is a self-hosted wellness journal for daily check-ins, measurements,
health records, medications, appointments, and follow-up reminders. It records
what you enter without treating missing days as failures or offering medical
advice.

## What it includes

- Daily fasting, weight, blood pressure, pulse, activity, and sleep check-ins
- Configurable trackers with history and corrections
- Multiple blood-pressure readings per day
- Health-record history with source flags preserved
- Medication schedules and as-needed dose logs
- Appointments and follow-up reminders
- A mobile-friendly interface and installable web app
- Local SQLite storage

The included health-record seed is empty. Add your own records after starting
the app; personal data is never part of the source distribution.

## Run on your Mac

Rise requires Node.js 22 or newer and Python 3.11 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Rise creates its database at `data/rise.db`.

## Checks

```bash
npm run build
npm test
```

Rise is a record-keeping tool, not a medical service. It does not diagnose,
interpret results, recommend treatment, or replace professional care.
