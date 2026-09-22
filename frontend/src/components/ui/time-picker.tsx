import { useMemo, useState } from "react";
import { Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function currentTimeValue(step = 5) {
  const now = new Date();
  const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / step) * step;
  const minutes = rounded % (24 * 60);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function displayTime(value: string) {
  const parsed = parseTime(value);
  if (!parsed) return "";
  const hour = parsed.hour % 12 || 12;
  return `${hour}:${pad(parsed.minute)} ${parsed.hour >= 12 ? "PM" : "AM"}`;
}

type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minuteStep?: number;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  "aria-label"?: string;
};

export function TimePicker({
  value,
  onChange,
  placeholder = "Choose time",
  minuteStep = 5,
  className,
  disabled,
  allowClear = false,
  "aria-label": ariaLabel = "Choose time",
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseTime(value) || parseTime(currentTimeValue(minuteStep))!;
  const hour12 = parsed.hour % 12 || 12;
  const period = parsed.hour >= 12 ? "PM" : "AM";
  const minutes = useMemo(() => {
    const values = Array.from(
      { length: Math.ceil(60 / minuteStep) },
      (_, index) => Math.min(index * minuteStep, 59),
    );
    if (!values.includes(parsed.minute)) values.push(parsed.minute);
    return [...new Set(values)].sort((a, b) => a - b);
  }, [minuteStep, parsed.minute]);

  function update(nextHour12: number, nextMinute: number, nextPeriod: string) {
    const hour = (nextHour12 % 12) + (nextPeriod === "PM" ? 12 : 0);
    onChange(`${pad(hour)}:${pad(nextMinute)}`);
  }

  return (
    <div className={cn("flex min-w-0 gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              "min-w-0 flex-1 justify-start px-3 text-left font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <Clock3 className="shrink-0" />
            <span className="truncate">{value ? displayTime(value) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 max-w-[calc(100vw-1.5rem)] space-y-3" align="start">
          <div className="grid grid-cols-[1fr_1fr_1.15fr] gap-2">
            <Select
              value={String(hour12)}
              onValueChange={(next) => update(Number(next), parsed.minute, period)}
            >
              <SelectTrigger aria-label={`${ariaLabel}: hour`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {hour}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(parsed.minute)}
              onValueChange={(next) => update(hour12, Number(next), period)}
            >
              <SelectTrigger aria-label={`${ariaLabel}: minute`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {minutes.map((minute) => (
                  <SelectItem key={minute} value={String(minute)}>
                    {pad(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={period}
              onValueChange={(next) => update(hour12, parsed.minute, next)}
            >
              <SelectTrigger aria-label={`${ariaLabel}: AM or PM`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => {
              onChange(currentTimeValue(minuteStep));
              setOpen(false);
            }}
          >
            Use current time
          </Button>
        </PopoverContent>
      </Popover>
      {allowClear && value && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Clear time"
          onClick={() => onChange("")}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
