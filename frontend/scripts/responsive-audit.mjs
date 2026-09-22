import { chromium } from "playwright";

const baseUrl = process.env.RISE_AUDIT_URL || "http://127.0.0.1:8891/";
const widths = [320, 390, 488, 552, 760, 1309, 1440];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];

async function seedChartScenarios() {
  const url = new URL(baseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return;
  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const anchor = new Date();
  const previous = new Date(anchor);
  previous.setDate(previous.getDate() - 1);
  const days = [dateKey(previous), dateKey(anchor)];
  const request = async (path, options = {}) => {
    const response = await fetch(new URL(path, baseUrl), {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    if (!response.ok)
      throw new Error(`Chart audit setup failed: ${path} ${response.status}`);
    return response.json();
  };

  await request(`/api/checkins/${days[0]}`, {
    method: "PUT",
    body: JSON.stringify({
      fasting_minutes: 1080,
      activity_status: "skipped",
      sleep_minutes: 420,
      weight_kg: 81.4,
      bp_systolic: 128,
      bp_diastolic: 84,
      pulse_bpm: 71,
    }),
  });
  await request(`/api/checkins/${days[1]}`, {
    method: "PUT",
    body: JSON.stringify({
      fasting_minutes: 1200,
      activity_minutes: 60,
      sleep_minutes: 465,
      weight_kg: 80.9,
      bp_systolic: 122,
      bp_diastolic: 79,
      pulse_bpm: 66,
    }),
  });

  const trackerResponse = await request("/api/trackers?days=120");
  const existing = trackerResponse.trackers;
  const ensureTracker = async (definition) => {
    const found = existing.find((tracker) => tracker.key === definition.key);
    if (found) return found;
    const created = await request("/api/trackers", {
      method: "POST",
      body: JSON.stringify(definition),
    });
    existing.push(created.tracker);
    return created.tracker;
  };
  const mood = await ensureTracker({
    key: "responsive_audit_mood",
    name: "Audit mood",
    category: "How you feel",
    value_type: "choice",
    unit: "",
    frequency: "daily",
    choices: ["Low", "Okay", "Good"],
    goal: {},
  });
  const single = await ensureTracker({
    key: "responsive_audit_single",
    name: "Audit single reading",
    category: "Audit",
    value_type: "number",
    unit: "units",
    frequency: "daily",
    choices: [],
    goal: {},
  });
  await ensureTracker({
    key: "responsive_audit_empty",
    name: "Audit empty tracker",
    category: "Audit",
    value_type: "number",
    unit: "units",
    frequency: "daily",
    choices: [],
    goal: {},
  });
  for (const [day, value] of [
    [days[0], "Okay"],
    [days[1], "Good"],
  ]) {
    await request("/api/tracker-entries", {
      method: "POST",
      body: JSON.stringify({ tracker_id: mood.id, day, value }),
    });
  }
  await request("/api/tracker-entries", {
    method: "POST",
    body: JSON.stringify({ tracker_id: single.id, day: days[1], value: 42 }),
  });
  const bloodPressure = existing.find(
    (tracker) => tracker.key === "blood_pressure",
  );
  if (bloodPressure && bloodPressure.entries.length < 2) {
    for (const [day, hour, systolic, diastolic, pulse] of [
      [days[0], "07:30:00", 128, 84, 71],
      [days[1], "07:45:00", 122, 79, 66],
    ]) {
      await request("/api/tracker-entries", {
        method: "POST",
        body: JSON.stringify({
          tracker_id: bloodPressure.id,
          day,
          observed_at: new Date(`${day}T${hour}`).toISOString(),
          value: { systolic, diastolic, pulse },
        }),
      });
    }
  }

  const care = await request(
    `/api/care?day=${days[1]}&include_inactive=1`,
  );
  if (!care.medications.some((item) => item.name === "Audit medicine")) {
    await request("/api/medications", {
      method: "POST",
      body: JSON.stringify({
        name: "Audit medicine",
        strength: "10 mg",
        instructions: "Take with food",
        schedule_kind: "daily",
        schedule_times: ["08:00"],
        schedule_days: [],
        start_date: days[0],
        end_date: null,
        active: true,
        note: null,
      }),
    });
  }
  const tomorrow = new Date(anchor);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  if (!care.appointments.some((item) => item.title === "Audit appointment")) {
    await request("/api/appointments", {
      method: "POST",
      body: JSON.stringify({
        title: "Audit appointment",
        starts_at: tomorrow.toISOString(),
        status: "scheduled",
        provider: "Audit clinic",
        location: "Clinic",
        note: "Bring reports",
      }),
    });
  }
  if (!care.reminders.some((item) => item.title === "Audit follow-up")) {
    const due = new Date(tomorrow);
    due.setHours(9, 0, 0, 0);
    await request("/api/reminders", {
      method: "POST",
      body: JSON.stringify({
        title: "Audit follow-up",
        due_at: due.toISOString(),
        status: "pending",
        appointment_id: null,
        note: "Book the next visit",
      }),
    });
  }
}

await seedChartScenarios();

for (const width of widths) {
  const viewportHeight = width === 552 ? 964 : 900;
  const page = await browser.newPage({
    viewport: { width, height: viewportHeight },
  });
  const errors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Check in", exact: true }).waitFor();
  if (await page.getByText("Fasting", { exact: true }).count())
    failures.push(`${width}px Today still shows the tracking summary cards`);
  if (await page.getByText("More from today", { exact: true }).count())
    failures.push(`${width}px Today still shows More from today`);
  for (const item of [
    "Sleep",
    "Rested",
    "Bedtime",
    "Fast",
    "Activity",
    "Weight",
    "Blood pressure",
    "Pulse",
  ])
    await page.getByText(item, { exact: true }).first().waitFor();
  if ((await page.getByText("Weight", { exact: true }).count()) !== 1)
    failures.push(`${width}px Today does not show Weight exactly once`);
  if (width < 768) {
    const mobileComposition = await page.evaluate(() => {
      const surface = document.querySelector('[data-testid="today-surface"]');
      const checkin = document.querySelector(".mobile-checkin-fab");
      const mobileNav = document.querySelector(
        'nav[aria-label="Primary navigation"].fixed',
      );
      const activeNav = document.querySelector(
        'nav[aria-label="Primary navigation"].fixed button',
      );
      const surfaceStyle = surface ? getComputedStyle(surface) : null;
      const checkinStyle = checkin ? getComputedStyle(checkin) : null;
      const navStyle = activeNav ? getComputedStyle(activeNav) : null;
      const checkinBox = checkin?.getBoundingClientRect();
      const navBox = mobileNav?.getBoundingClientRect();
      return {
        surfaceBorder: surfaceStyle?.borderTopWidth ?? "missing",
        surfaceBackground: surfaceStyle?.backgroundColor ?? "missing",
        navDirection: navStyle?.flexDirection ?? "missing",
        checkinPosition: checkinStyle?.position ?? "missing",
        checkinClearsNav:
          Boolean(checkinBox && navBox) && checkinBox.bottom <= navBox.top,
        checkinIsFab:
          Boolean(checkinBox) &&
          Math.abs((checkinBox?.width ?? 0) - 56) < 1 &&
          Math.abs((checkinBox?.height ?? 0) - 56) < 1,
        checkinHasNoVisibleLabel: checkin?.textContent?.trim() === "",
        checkinRightGap: checkinBox
          ? Math.round(window.innerWidth - checkinBox.right)
          : -1,
      };
    });
    if (mobileComposition.surfaceBorder !== "0px")
      failures.push(`${width}px Today still uses a desktop card border`);
    if (mobileComposition.navDirection !== "column")
      failures.push(`${width}px mobile navigation is not thumb-first`);
    if (mobileComposition.checkinPosition !== "fixed")
      failures.push(`${width}px Check in is not a floating action`);
    if (!mobileComposition.checkinClearsNav)
      failures.push(`${width}px floating Check in overlaps mobile navigation`);
    if (!mobileComposition.checkinIsFab)
      failures.push(`${width}px Check in is not a 56px circular FAB`);
    if (!mobileComposition.checkinHasNoVisibleLabel)
      failures.push(`${width}px Check in FAB still has a visible text label`);
    if (mobileComposition.checkinRightGap < 19)
      failures.push(`${width}px Check in FAB is too close to the right edge`);
  }
  if (width === 390)
    await page.screenshot({
      path: "/tmp/rise-today-mobile.png",
      fullPage: false,
    });
  if (width < 768) {
    await page.addStyleTag({
      content:
        ":root{--safe-area-top:47px!important;--safe-area-right:0px!important;--safe-area-bottom:34px!important;--safe-area-left:0px!important}",
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );
    const safeArea = await page.evaluate(() => {
      const logo = document.querySelector('[aria-label="Rise home"]');
      const header = document.querySelector("header");
      const mobileNav = document.querySelector(
        'nav[aria-label="Primary navigation"].fixed',
      );
      const logoBox = logo?.getBoundingClientRect();
      const headerBox = header?.getBoundingClientRect();
      const navBox = mobileNav?.getBoundingClientRect();
      return {
        logoTop: logoBox?.top ?? -1,
        headerHeight: headerBox?.height ?? -1,
        headerPosition: header ? getComputedStyle(header).position : "missing",
        navHeight: navBox?.height ?? -1,
        navBottom: navBox?.bottom ?? -1,
        viewportHeight: window.innerHeight,
      };
    });
    if (safeArea.logoTop < 47)
      failures.push(
        `${width}px logo overlaps simulated status bar: ${safeArea.logoTop}px`,
      );
    if (Math.abs(safeArea.navBottom - safeArea.viewportHeight) > 1)
      failures.push(
        `${width}px bottom navigation misses safe edge: ${JSON.stringify(safeArea)}`,
      );
    if (safeArea.headerHeight - 47 > 57)
      failures.push(
        `${width}px mobile header is too tall: ${JSON.stringify(safeArea)}`,
      );
    if (safeArea.navHeight - 34 > 58)
      failures.push(
        `${width}px mobile navigation is too tall: ${JSON.stringify(safeArea)}`,
      );
    if (
      safeArea.headerPosition === "sticky" ||
      safeArea.headerPosition === "fixed"
    )
      failures.push(
        `${width}px mobile header should scroll with content: ${JSON.stringify(safeArea)}`,
      );
  }
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
    navVisible: [...document.querySelectorAll("nav")].some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }),
  }));
  if (layout.scrollWidth > layout.viewport + 1)
    failures.push(`${width}px horizontal overflow: ${layout.scrollWidth}px`);
  if (!layout.navVisible) failures.push(`${width}px navigation missing`);
  if (width === 390)
    await page.screenshot({
      path: "/tmp/rise-pwa-mobile-safearea.png",
      fullPage: false,
    });

  if (
    await page
      .getByRole("button", { name: "Selected day", exact: true })
      .count()
  )
    failures.push(`${width}px duplicate Today date picker is still visible`);
  if (await page.getByRole("heading", { name: "Week", exact: true }).count())
    failures.push(`${width}px redundant Week heading is still visible`);

  for (const [measurement, tab] of [
    ["Sleep", "Sleep"],
    ["Fast", "Fast"],
    ["Activity", "Move"],
    ["Weight", "Measure"],
  ]) {
    await page
      .getByRole("button", { name: `Record ${measurement}`, exact: true })
      .click();
    const quickDialog = page.getByRole("dialog", { name: "Daily check-in" });
    await quickDialog.waitFor();
    const activeTab = quickDialog.getByRole("tab", { name: tab, exact: true });
    if ((await activeTab.getAttribute("data-state")) !== "active")
      failures.push(`${width}px ${measurement} did not open ${tab}`);
    await quickDialog
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await quickDialog.waitFor({ state: "hidden" });
  }

  await page
    .getByRole("button", { name: "Sleep options", exact: true })
    .click();
  const sleepOptions = page.getByRole("dialog", { name: "Sleep", exact: true });
  await sleepOptions.waitFor();
  await sleepOptions
    .getByRole("switch", { name: "Show Sleep on Today", exact: true })
    .click();
  await sleepOptions.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Record Sleep", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Trends", exact: true })
    .first()
    .click();
  const hiddenToday = page.getByText("Hidden from Today", { exact: true });
  await hiddenToday.waitFor();
  await hiddenToday
    .locator("xpath=parent::*")
    .getByRole("button", { name: "Sleep", exact: true })
    .click();
  await hiddenToday.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Today", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Record Sleep", exact: true })
    .waitFor();

  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  const todayButton = page.getByRole("button", {
    name: "Go to today",
    exact: true,
  });
  await todayButton.waitFor();
  await todayButton.click();
  await page
    .getByRole("button", { name: /today$/, exact: false })
    .filter({ visible: true })
    .first()
    .waitFor();

  await page.getByRole("button", { name: "Check in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Daily check-in" });
  await dialog.waitFor();
  for (const label of ["Sleep", "Fast", "Move", "Measure"])
    await dialog.getByRole("tab", { name: label, exact: true }).waitFor();
  const bedtimePicker = dialog.getByRole("button", {
    name: "Bedtime",
    exact: true,
  });
  await bedtimePicker.waitFor();
  if ((await bedtimePicker.innerText()).includes("Choose time"))
    failures.push(`${width}px bedtime is not prefilled`);
  if (
    await dialog
      .locator(
        'input[type="date"], input[type="time"], input[type="datetime-local"]',
      )
      .count()
  )
    failures.push(
      `${width}px check-in still uses a native browser date/time input`,
    );
  await page.waitForTimeout(250);
  const box = await dialog.boundingBox();
  if (!box || box.x < -2 || box.x + box.width > width + 2)
    failures.push(
      `${width}px check-in dialog outside viewport: ${JSON.stringify(box)}`,
    );
  if (
    width < 640 &&
    (!box ||
      Math.abs(box.x) > 2 ||
      Math.abs(box.width - width) > 2 ||
      Math.abs(box.y + box.height - viewportHeight) > 2)
  )
    failures.push(
      `${width}px check-in is not a full-width bottom sheet: ${JSON.stringify(box)}`,
    );
  await page.getByRole("button", { name: "Check-in day", exact: true }).click();
  const dialogCalendar = page.getByRole("grid").last();
  await dialogCalendar.waitFor();
  const dialogCalendarBox = await dialogCalendar.boundingBox();
  if (
    !dialogCalendarBox ||
    dialogCalendarBox.x < -2 ||
    dialogCalendarBox.x + dialogCalendarBox.width > width + 2
  )
    failures.push(
      `${width}px dialog calendar outside viewport: ${JSON.stringify(dialogCalendarBox)}`,
    );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const [label, heading] of [
    ["Trends", null],
    ["Records", "See changes over time."],
    ["Care", null],
  ]) {
    await page
      .getByRole("button", { name: label, exact: true })
      .first()
      .click();
    if (heading) await page.getByText(heading, { exact: true }).waitFor();
    if (label === "Care") {
      await page
        .getByRole("button", { name: "Care day", exact: true })
        .waitFor();
      for (const name of [
        "View Audit medicine medication",
        "View Audit appointment appointment",
        "View Audit follow-up reminder",
      ])
        await page.getByRole("button", { name, exact: true }).waitFor();
      for (const copy of [
        "Your care",
        "Stay on top of your care.",
        "What to take today.",
        "Upcoming visits and things to do.",
      ]) {
        if (await page.getByText(copy, { exact: true }).count())
          failures.push(`${width}px Care still shows repeated intro copy`);
      }
    }
    if (
      label === "Records" &&
      (await page
        .getByRole("heading", { name: "Test results", exact: true })
        .count())
    )
      failures.push(`${width}px duplicate Records header is still visible`);
    if (
      label === "Records" &&
      (await page
        .getByText("Add another result to see a change", { exact: true })
        .count())
    )
      failures.push(
        `${width}px repeated single-result chart placeholder is still visible`,
      );
    if (label === "Records") {
      const singleResultCards = page.locator(
        '[data-testid="health-trend-card"][data-result-count="1"]',
      );
      const multipleResultCards = page.locator(
        '[data-testid="health-trend-card"]:not([data-result-count="1"])',
      );
      if (!(await singleResultCards.count()))
        failures.push(`${width}px Records audit has no single-result card`);
      if (!(await multipleResultCards.count()))
        failures.push(`${width}px Records audit has no multi-result card`);
      if (
        await singleResultCards
          .getByRole("img", { name: "Values over time" })
          .count()
      )
        failures.push(`${width}px single-result cards show an empty chart`);
      if (
        !(await multipleResultCards
          .getByRole("img", { name: "Values over time" })
          .count())
      )
        failures.push(`${width}px multi-result cards omit the trend chart`);
      if (
        await page
          .getByRole("heading", { name: "History", exact: true })
          .count()
      )
        failures.push(`${width}px Records cards still show inline history`);

      await singleResultCards.getByRole("button").first().click();
      const singleResultDialog = page.getByRole("dialog").last();
      await singleResultDialog.waitFor();
      if (
        await singleResultDialog
          .getByRole("heading", { name: "History", exact: true })
          .count()
      )
        failures.push(
          `${width}px single-result details show a history section`,
        );
      if (
        !(await singleResultDialog
          .getByText("Lab range", { exact: true })
          .count())
      )
        failures.push(`${width}px single-result details omit the lab range`);
      if (width < 640) {
        const detailBox = await singleResultDialog.boundingBox();
        if (
          !detailBox ||
          Math.abs(detailBox.x) > 2 ||
          Math.abs(detailBox.width - width) > 2 ||
          Math.abs(detailBox.y + detailBox.height - viewportHeight) > 2
        )
          failures.push(
            `${width}px record details are not a full-width bottom sheet: ${JSON.stringify(detailBox)}`,
          );
      }
      await singleResultDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await singleResultDialog.waitFor({ state: "hidden" });

      await multipleResultCards.getByRole("button").first().click();
      const multipleResultDialog = page.getByRole("dialog").last();
      await multipleResultDialog.waitFor();
      if (
        !(await multipleResultDialog
          .getByRole("heading", { name: "History", exact: true })
          .count())
      )
        failures.push(`${width}px multi-result details omit history`);
      await multipleResultDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await multipleResultDialog.waitFor({ state: "hidden" });
    }
    if (label === "Records" && (width === 390 || width === 552))
      await page.screenshot({
        path:
          width === 552
            ? "/tmp/rise-records-552x964.png"
            : "/tmp/rise-records-mobile.png",
        fullPage: false,
      });
    if (label === "Trends") {
      await page
        .getByRole("combobox", { name: "Time range", exact: true })
        .waitFor();
      if (
        await page
          .getByRole("button", { name: "History date", exact: true })
          .count()
      )
        failures.push(
          `${width}px Trends still shows an unexplained history date`,
        );
      if (
        await page
          .getByText("Trend appears after two readings", { exact: true })
          .count()
      )
        failures.push(`${width}px Trends still repeats the empty trend prompt`);
      for (const metric of [
        "Fasting",
        "Weight",
        "Blood pressure",
        "Activity",
        "Sleep",
      ])
        await page.getByText(metric, { exact: true }).first().waitFor();
      const chartDetails = [
        ["Fasting", "Fasting trend, bar chart"],
        ["Activity", "Activity trend, bar chart"],
        ["Sleep", "Sleep trend, bar chart"],
        ["Weight", "Weight trend, line chart"],
        [
          "Blood pressure",
          "Blood pressure trend, systolic and diastolic line chart",
        ],
        ["Audit mood", "Audit mood trend, bar chart"],
        ["Audit single reading", "Audit single reading trend, point chart"],
      ];
      for (const [metric, chartName] of chartDetails) {
        const cardButton = page.getByRole("button", {
          name: `View ${metric} details`,
          exact: true,
        });
        if (
          (await cardButton
            .getByRole("img", { name: chartName, exact: true })
            .count()) !== 1
        )
          failures.push(`${width}px ${metric} card omits its compact chart`);
        await cardButton.click();
        const detailDialog = page.getByRole("dialog", {
          name: metric,
          exact: true,
        });
        await detailDialog.waitFor();
        if (
          (await detailDialog
            .getByRole("img", { name: chartName, exact: true })
            .count()) !== 1
        )
          failures.push(`${width}px ${metric} details use the wrong chart`);
        if (width < 640 && metric === "Fasting") {
          const detailBox = await detailDialog.boundingBox();
          if (
            !detailBox ||
            Math.abs(detailBox.x) > 2 ||
            Math.abs(detailBox.width - width) > 2 ||
            Math.abs(detailBox.y + detailBox.height - viewportHeight) > 2
          )
            failures.push(
              `${width}px trend details are not a full-width bottom sheet: ${JSON.stringify(detailBox)}`,
            );
        }
        await detailDialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await detailDialog.waitFor({ state: "hidden" });
      }

      const emptyAuditButton = page.getByRole("button", {
        name: "View Audit empty tracker details",
        exact: true,
      });
      if (await emptyAuditButton.getByRole("img").count())
        failures.push(`${width}px empty tracker card shows an empty chart`);
      await emptyAuditButton.click();
      const emptyAuditDialog = page.getByRole("dialog", {
        name: "Audit empty tracker",
        exact: true,
      });
      await emptyAuditDialog.waitFor();
      if (await emptyAuditDialog.getByRole("img").count())
        failures.push(`${width}px empty tracker details still render a chart`);
      await emptyAuditDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await emptyAuditDialog.waitFor({ state: "hidden" });
      if (
        await page.getByText("Recorded for this day", { exact: true }).count()
      )
        failures.push(`${width}px Trends still shows single-day summary cards`);
      if (await page.getByText("20:4", { exact: true }).count())
        failures.push(
          `${width}px Trends still shows the single-day fasting card`,
        );
      await page
        .getByRole("button", { name: "View Fasting details", exact: true })
        .click();
      const fastingDetails = page.getByRole("dialog", {
        name: "Fasting",
        exact: true,
      });
      await fastingDetails.waitFor();
      await fastingDetails
        .getByRole("button", { name: "Add reading", exact: true })
        .click();
      const checkinFromTrack = page.getByRole("dialog", {
        name: "Daily check-in",
      });
      await checkinFromTrack.waitFor();
      await checkinFromTrack
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await checkinFromTrack.waitFor({ state: "hidden" });
      const emptyTracker = page
        .getByText("No readings yet", { exact: true })
        .first();
      if (await emptyTracker.count()) {
        const emptyCard = emptyTracker.locator(
          "xpath=ancestor::*[contains(@class,'rounded-lg') and contains(@class,'border')][1]",
        );
        if (await emptyCard.locator('svg[aria-label$=" trend"]').count())
          failures.push(
            `${width}px empty Track card still reserves a chart gap`,
          );
      }
      if (width === 390)
        await page.screenshot({
          path: "/tmp/rise-track-mobile.png",
          fullPage: false,
        });
      await page
        .getByRole("button", {
          name: "View Audit single reading details",
          exact: true,
        })
        .click();
      const editableDetails = page.getByRole("dialog", {
        name: "Audit single reading",
        exact: true,
      });
      await editableDetails.waitFor();
      const editReading = editableDetails
        .getByRole("button", { name: /^Edit .* reading from / })
        .first();
      await editReading.waitFor();
      await editReading.click();
      const editDialog = page.getByRole("dialog", { name: /^Edit / });
      await editDialog.waitFor();
      await editDialog
        .getByRole("button", { name: "Reading day", exact: true })
        .waitFor();
      await editDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      if (
        await page
          .getByRole("button", { name: "Add measurement", exact: true })
          .count()
      )
        failures.push(
          `${width}px Trends still shows the add measurement action`,
        );
      if (
        await page
          .getByRole("button", { name: "Add reading", exact: true })
          .count()
      )
        failures.push(`${width}px Trends still shows reading actions`);
      await page
        .getByRole("button", { name: "Today", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Add measurement", exact: true })
        .click();
      const trackerDialog = page.getByRole("dialog", {
        name: "Add measurement",
      });
      await trackerDialog.waitFor();
      if (await trackerDialog.getByRole("textbox").count())
        failures.push(
          `${width}px tracker setup still exposes manual text fields`,
        );
      await trackerDialog
        .getByRole("combobox", { name: "Tracker category", exact: true })
        .click();
      await page.getByRole("option", { name: "Body", exact: true }).click();
      await trackerDialog
        .getByRole("combobox", { name: "Tracker", exact: true })
        .click();
      await page.getByRole("option", { name: "Weight", exact: true }).click();
      await trackerDialog.getByText("kg", { exact: true }).waitFor();
      await trackerDialog
        .getByRole("combobox", { name: "Tracker", exact: true })
        .click();
      await page.getByRole("option", { name: "Other", exact: true }).click();
      await trackerDialog
        .getByPlaceholder("What do you call it?", { exact: true })
        .waitFor();
      if (await trackerDialog.locator('input[placeholder="mg/dL"]').count())
        failures.push(`${width}px tracker setup still exposes a unit input`);
      await trackerDialog
        .getByRole("combobox", { name: "Recording style", exact: true })
        .waitFor();
      await trackerDialog
        .getByRole("combobox", { name: "Recording frequency", exact: true })
        .waitFor();
      await trackerDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Trends", exact: true })
        .first()
        .click();
    }
    if (label === "Care" && width === 390) {
      const medicineCard = page.getByRole("button", {
        name: "View Audit medicine medication",
        exact: true,
      });
      await medicineCard.click();
      const medicineDetails = page.getByRole("dialog", {
        name: "Audit medicine",
        exact: true,
      });
      await medicineDetails.waitFor();
      const detailsBox = await medicineDetails.boundingBox();
      if (
        !detailsBox ||
        Math.abs(detailsBox.x) > 2 ||
        Math.abs(detailsBox.width - width) > 2 ||
        Math.abs(detailsBox.y + detailsBox.height - viewportHeight) > 2
      )
        failures.push(
          `390px medicine details are not a full-width bottom sheet: ${JSON.stringify(detailsBox)}`,
        );
      await medicineDetails
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await medicineDetails.waitFor({ state: "hidden" });

      await page
        .getByRole("button", { name: "Add care item", exact: true })
        .click();
      const addCareDialog = page.getByRole("dialog", {
        name: "Add",
        exact: true,
      });
      await addCareDialog.waitFor();
      const addBox = await addCareDialog.boundingBox();
      if (
        !addBox ||
        Math.abs(addBox.x) > 2 ||
        Math.abs(addBox.width - width) > 2 ||
        Math.abs(addBox.y + addBox.height - viewportHeight) > 2
      )
        failures.push(
          `390px add care is not a full-width bottom sheet: ${JSON.stringify(addBox)}`,
        );
      await addCareDialog
        .getByRole("button", { name: "Medicine", exact: true })
        .click();
      const medicineDialog = page.getByRole("dialog", {
        name: "Add medication",
        exact: true,
      });
      await medicineDialog.waitFor();
      await medicineDialog
        .getByRole("button", { name: "Medication start date", exact: true })
        .waitFor();
      const medicineTime = medicineDialog.getByRole("button", {
        name: "Medication time 1",
        exact: true,
      });
      await medicineTime.waitFor();
      if (!(await medicineTime.innerText()).includes("8:00 AM"))
        failures.push("390px medication time is not prefilled");
      if (
        await medicineDialog
          .locator(
            'input[type="date"], input[type="time"], input[type="datetime-local"]',
          )
          .count()
      )
        failures.push(
          "390px medicine form still uses native browser date/time inputs",
        );
      await medicineDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await medicineDialog.waitFor({ state: "hidden" });

      await page
        .getByRole("button", { name: "Add care item", exact: true })
        .click();
      const nextAddCareDialog = page.getByRole("dialog", {
        name: "Add",
        exact: true,
      });
      await nextAddCareDialog.waitFor();
      await nextAddCareDialog
        .getByRole("button", { name: "Appointment", exact: true })
        .click();
      const appointmentDialog = page.getByRole("dialog", {
        name: "Add appointment",
        exact: true,
      });
      await appointmentDialog.waitFor();
      await appointmentDialog
        .getByRole("button", {
          name: "Appointment date and time: date",
          exact: true,
        })
        .waitFor();
      const appointmentTime = appointmentDialog.getByRole("button", {
        name: "Appointment date and time: time",
        exact: true,
      });
      await appointmentTime.waitFor();
      if ((await appointmentTime.innerText()).includes("Choose time"))
        failures.push("390px appointment time is not prefilled");
      if (
        await appointmentDialog
          .locator(
            'input[type="date"], input[type="time"], input[type="datetime-local"]',
          )
          .count()
      )
        failures.push(
          "390px appointment form still uses native browser date/time inputs",
        );
      await appointmentDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await appointmentDialog.waitFor({ state: "hidden" });
    }
    const currentScrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    if (currentScrollWidth > width + 1) {
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 50),
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          }))
          .filter((item) => item.right > window.innerWidth + 1)
          .slice(0, 5),
      );
      failures.push(
        `${width}px ${label} overflow: ${currentScrollWidth}px ${JSON.stringify(offenders)}`,
      );
    }
  }
  if (errors.length) failures.push(`${width}px console: ${errors.join(" | ")}`);
  console.log(`${width}px ok`);
  await page.close();
}

await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("responsive audit passed");
