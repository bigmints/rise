import { useEffect, useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  HeartPulse,
  Home,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { CareView } from "@/components/care-view";
import { RecordsView } from "@/components/records-view";
import { RiseLogo } from "@/components/rise-logo";
import {
  CheckinDialog,
  TodayView,
  type CheckinTab,
} from "@/components/today-view";
import {
  TrackerDefinitionDialog,
  TrackersView,
} from "@/components/trackers-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { useRiseData } from "@/hooks/use-rise-data";
import { localDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "today" | "trackers" | "records" | "care";

const nav = [
  { id: "today", label: "Today", icon: Home },
  { id: "trackers", label: "Trends", icon: ChartNoAxesColumnIncreasing },
  { id: "records", label: "Records", icon: ClipboardList },
  { id: "care", label: "Care", icon: HeartPulse },
] as const;

export function App() {
  const [view, setView] = useState<View>("today");
  const days = 30;
  const [selectedDay, setSelectedDay] = useState(localDateKey());
  const [checkinOpen, setCheckinOpen] = useState(
    window.location.hash === "#checkin",
  );
  const [checkinTab, setCheckinTab] = useState<CheckinTab>("sleep");
  const [addMeasurementOpen, setAddMeasurementOpen] = useState(false);
  const rise = useRiseData(days, selectedDay);

  function openCheckin(tab: CheckinTab = "sleep") {
    setCheckinTab(tab);
    setCheckinOpen(true);
  }

  function changeView(nextView: View) {
    if (nextView === "trackers") setSelectedDay(localDateKey());
    setView(nextView);
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [view]);

  return (
    <div className="app-bottom-space min-h-dvh">
      <header className="safe-top z-40 border-b border-border/70 bg-background/95 backdrop-blur-xl md:sticky md:top-0">
        <div className="safe-inline mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 md:h-16">
          <RiseLogo />
          <nav
            className="hidden items-center gap-1 rounded-lg bg-muted p-1 md:flex"
            aria-label="Primary navigation"
          >
            {nav.map((item) => (
              <NavButton
                key={item.id}
                active={view === item.id}
                onClick={() => changeView(item.id)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "hidden items-center gap-1.5 text-xs sm:flex",
                rise.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {rise.error ? (
                <WifiOff className="size-3.5" />
              ) : (
                <Wifi className="size-3.5 text-primary" />
              )}
              {rise.error ? "Offline" : "Up to date"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh data"
              onClick={() => void rise.refresh()}
              disabled={rise.refreshing}
            >
              <RefreshCw className={cn(rise.refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <main className="safe-inline mx-auto max-w-7xl space-y-3 py-3 sm:space-y-4 sm:py-6">
        {view === "today" && (
          <Button
            className="hidden h-12 w-full rounded-xl text-base md:inline-flex"
            onClick={() => openCheckin()}
            disabled={rise.loading || Boolean(rise.error)}
          >
            <Plus />
            Check in
          </Button>
        )}

        {rise.loading ? (
          <DashboardSkeleton />
        ) : rise.error ? (
          <ErrorState message={rise.error} retry={() => void rise.refresh()} />
        ) : (
          <>
            {view === "today" && (
              <TodayView
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                days={days}
                checkins={rise.data.checkins}
                trackers={rise.data.trackers}
                todayItems={rise.data.todayItems}
                events={rise.data.events}
                saveCheckin={rise.saveCheckin}
                saveTrackerEntry={rise.saveTrackerEntry}
                updateTrackerEntry={rise.updateTrackerEntry}
                reload={rise.reload}
                checkinOpen={checkinOpen}
                setCheckinOpen={setCheckinOpen}
                openCheckin={openCheckin}
                openAddMeasurement={() => setAddMeasurementOpen(true)}
              />
            )}
            {view === "trackers" && (
              <TrackersView
                trackers={rise.data.trackers}
                todayItems={rise.data.todayItems}
                checkins={rise.data.checkins}
                events={rise.data.events}
                openCheckin={openCheckin}
                saveTrackerEntry={rise.saveTrackerEntry}
                updateTrackerEntry={rise.updateTrackerEntry}
                reload={rise.reload}
              />
            )}
            {view === "records" && (
              <RecordsView
                reports={rise.data.reports}
                histories={rise.data.histories}
              />
            )}
            {view === "care" && (
              <CareView
                care={rise.data.care}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                reload={rise.reload}
              />
            )}
          </>
        )}
          {view === "today" && (
            <Button
              size="icon"
              className="mobile-checkin-fab size-14 rounded-full p-0 shadow-xl md:hidden [&_svg]:size-6"
              aria-label="Check in"
              onClick={() => openCheckin()}
              disabled={rise.loading || Boolean(rise.error)}
            >
              <Plus />
            </Button>
          )}
      </main>

      <nav
        className="safe-bottom safe-nav-inline fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/95 pt-1.5 backdrop-blur-xl md:hidden"
        aria-label="Primary navigation"
      >
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => changeView(item.id)}
              className={cn(
                "mx-1 flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium text-muted-foreground transition-colors",
                view === item.id && "bg-primary/10 text-primary",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      {!rise.loading && !rise.error && (
        <>
          <CheckinDialog
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            days={days}
            checkins={rise.data.checkins}
            trackers={rise.data.trackers}
            todayItems={rise.data.todayItems}
            events={rise.data.events}
            saveCheckin={rise.saveCheckin}
            saveTrackerEntry={rise.saveTrackerEntry}
            updateTrackerEntry={rise.updateTrackerEntry}
            reload={rise.reload}
            checkinOpen={checkinOpen}
            setCheckinOpen={setCheckinOpen}
            openCheckin={openCheckin}
            openAddMeasurement={() => setAddMeasurementOpen(true)}
            initialTab={checkinTab}
            open={checkinOpen}
            setOpen={setCheckinOpen}
          />
          <TrackerDefinitionDialog
            open={addMeasurementOpen}
            setOpen={setAddMeasurementOpen}
            tracker={null}
            trackers={rise.data.trackers}
            reload={rise.reload}
          />
        </>
      )}
      <Toaster richColors position="top-center" />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Home;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className={cn(active && "bg-background shadow-sm")}
      onClick={onClick}
    >
      <Icon />
      {label}
    </Button>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-48 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="grid place-items-center gap-3 p-12 text-center">
        <WifiOff className="size-8 text-destructive" />
        <div>
          <h2 className="font-medium">Rise could not load</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        <Button onClick={retry}>Try again</Button>
      </CardContent>
    </Card>
  );
}
