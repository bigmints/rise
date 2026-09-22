import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  buildHealthSeries,
  HEALTH_CATEGORIES,
  type HealthSeries,
} from "@/lib/health";
import { formatDay, formatNumber } from "@/lib/format";
import type { HealthHistoryPoint, HealthReport, HealthResult } from "@/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RecordsView({
  reports,
  histories,
}: {
  reports: HealthReport[];
  histories: Record<string, HealthHistoryPoint[]>;
}) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(reports[0]?.report_date || "");
  const resultLookup = useMemo(
    () =>
      new Map(
        reports
          .flatMap((report) => report.results)
          .map((result) => [result.canonical_key, result]),
      ),
    [reports],
  );
  const series = useMemo(
    () => buildHealthSeries(histories, resultLookup),
    [histories, resultLookup],
  );
  const filtered = series.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (!search || item.name.toLowerCase().includes(search.toLowerCase())),
  );
  const selectedReports = reports.filter(
    (report) => report.report_date === date,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <Badge variant="secondary">Results</Badge>
            <CardTitle className="font-display text-3xl font-normal">
              See changes over time.
            </CardTitle>
            <CardDescription>
              {series.length} results from {reports.length} reports.
            </CardDescription>
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a measurement"
            />
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="trends" className="min-w-0 overflow-hidden space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="trends">
            <TrendingUp className="mr-2 size-4" />
            Changes
          </TabsTrigger>
          <TabsTrigger value="reports">
            <FileText className="mr-2 size-4" />
            Reports
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trends" className="space-y-4">
          <div className="flex w-full max-w-[calc(100vw_-_2rem)] gap-2 overflow-x-auto pb-1">
            {HEALTH_CATEGORIES.map((item) => {
              const count =
                item.id === "all"
                  ? series.length
                  : series.filter((entry) => entry.category === item.id).length;
              if (!count && item.id !== "all") return null;
              return (
                <button
                  key={item.id}
                  onClick={() => setCategory(item.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${category === item.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  {item.label} <span className="opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((item) => (
              <TrendCard
                key={item.key}
                series={item}
                category={
                  HEALTH_CATEGORIES.find((entry) => entry.id === item.category)
                    ?.label || "Other"
                }
              />
            ))}
          </div>
          {!filtered.length && (
            <Card className="border-dashed">
              <CardContent className="grid place-items-center p-12 text-sm text-muted-foreground">
                No matching results.
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <div className="max-w-xs">
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger>
                <SelectValue placeholder="Report date" />
              </SelectTrigger>
              <SelectContent>
                {[...new Set(reports.map((report) => report.report_date))].map(
                  (reportDate) => (
                    <SelectItem key={reportDate} value={reportDate}>
                      {formatDay(reportDate, true)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedReports.map((report) => (
              <ReportCard key={report.id} report={report} search={search} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TrendCard({
  series,
  category,
}: {
  series: HealthSeries;
  category: string;
}) {
  const [open, setOpen] = useState(false);
  const latest = series.latest;
  const previous = series.previous;
  const delta =
    latest.numeric_value != null && previous?.numeric_value != null
      ? Number(latest.numeric_value) - Number(previous.numeric_value)
      : null;
  return (
    <>
      <Card
        className="overflow-hidden transition-colors hover:bg-accent/40"
        data-testid="health-trend-card"
        data-result-count={series.points.length}
      >
        <button
          type="button"
          className="w-full p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
          aria-label={`View ${series.name} details`}
          onClick={() => setOpen(true)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Badge variant="outline">{category}</Badge>
              <h3 className="truncate text-base font-medium">{series.name}</h3>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="text-2xl font-semibold tracking-tight">
                  {latest.value_text}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {latest.unit}
                  </span>
                </strong>
                <span className="text-xs text-muted-foreground">
                  {formatDay(latest.report_date)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="text-xs">
                {series.points.length} result
                {series.points.length === 1 ? "" : "s"}
              </span>
              <ChevronRight className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <HealthChart points={series.points} />
          </div>
        </button>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-detail-sheet max-h-[92vh] max-w-xl overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 p-5 pr-12 backdrop-blur sm:p-6">
            <DialogTitle className="pr-4 text-xl leading-snug">
              {series.name}
            </DialogTitle>
            <DialogDescription>
              {category} · {series.points.length} result
              {series.points.length === 1 ? "" : "s"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tracking-tight">
                  {latest.value_text}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {latest.unit}
                  </span>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Latest · {formatDay(latest.report_date)}
                  </span>
                  {latest.flag && (
                    <Badge
                      variant={
                        latest.flag === "H" || latest.flag === "L"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {latest.flag}
                    </Badge>
                  )}
                </div>
              </div>
              {delta != null && delta !== 0 ? (
                <div className="text-right">
                  <p className="flex items-center justify-end gap-1 text-sm font-medium">
                    {delta > 0 ? (
                      <ArrowUpRight className="size-4" />
                    ) : (
                      <ArrowDownRight className="size-4" />
                    )}
                    {delta > 0 ? "+" : "−"}
                    {formatNumber(Math.abs(delta))}
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    since {formatDay(previous!.report_date)}
                  </span>
                </div>
              ) : previous ? (
                <Badge variant="secondary">No change</Badge>
              ) : (
                <Badge variant="secondary">First result</Badge>
              )}
            </div>
            <HealthChart points={series.points} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
              <span>Lab range</span>
              <strong className="text-foreground">
                {latest.reference_range || "Not provided"}
              </strong>
            </div>
            {series.points.length > 1 && (
              <section
                className="space-y-2"
                aria-label={`${series.name} history`}
              >
                <h4 className="text-sm font-medium">History</h4>
                <div className="divide-y rounded-lg border">
                  {[...series.points].reverse().map((point) => (
                    <div
                      key={`${point.report_id}-${point.report_date}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {formatDay(point.report_date)}
                      </span>
                      <strong>
                        {point.value_text} {point.unit}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HealthChart({ points }: { points: HealthHistoryPoint[] }) {
  const numeric = points
    .filter((point) => point.numeric_value != null)
    .map((point) => Number(point.numeric_value));
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = max - min || 1;
  const coords = numeric.map((value, index) => ({
    x: 6 + (index / (numeric.length - 1)) * 288,
    y: 66 - ((value - min) / span) * 52,
  }));
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `M${coords[0].x},66 L${coords.map((point) => `${point.x},${point.y}`).join(" L")} L${coords[coords.length - 1].x},66 Z`;
  return (
    <div className="h-24 rounded-lg bg-muted/35 p-2">
      <svg
        viewBox="0 0 300 72"
        className="h-full w-full"
        role="img"
        aria-label="Values over time"
      >
        <defs>
          <linearGradient
            id={`fill-${numeric.join("-")}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="hsl(var(--primary))"
              stopOpacity=".25"
            />
            <stop
              offset="100%"
              stopColor="hsl(var(--primary))"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#fill-${numeric.join("-")})`} />
        <polyline
          points={line}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="3"
            fill="hsl(var(--background))"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
          />
        ))}
      </svg>
    </div>
  );
}

function ReportCard({
  report,
  search,
}: {
  report: HealthReport;
  search: string;
}) {
  const results = report.results.filter(
    (result) =>
      !search ||
      [
        result.name,
        result.value_text,
        result.flag,
        result.unit,
        result.reference_range,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl font-normal">
              {report.title}
            </CardTitle>
            <CardDescription>
              {report.provider || "Lab report"} ·{" "}
              {formatDay(report.report_date, true)}
            </CardDescription>
          </div>
          <Badge variant="secondary">{results.length} results</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {results.map((result) => (
          <ResultRow key={result.id} result={result} />
        ))}
        {!results.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No matching results.
          </p>
        )}
        <div className="border-t pt-3 text-xs text-muted-foreground">
          File: {report.source_filenames.join(", ")}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultRow({ result }: { result: HealthResult }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{result.name}</p>
        <p className="text-xs text-muted-foreground">
          {result.reference_range
            ? `Range ${result.reference_range}`
            : result.section}
        </p>
      </div>
      <div className="text-right">
        <strong className="text-sm">
          {result.value_text} {result.unit}
        </strong>
        {result.flag && (
          <Badge variant="destructive" className="ml-2">
            {result.flag}
          </Badge>
        )}
      </div>
      {result.detail && (
        <p className="col-span-2 text-xs text-muted-foreground">
          {result.detail}
        </p>
      )}
    </div>
  );
}
