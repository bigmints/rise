import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker, currentTimeValue } from "@/components/ui/time-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function dateFromKey(value?: string | null) {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function keyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  "aria-label"?: string;
};

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  className,
  disabled,
  allowClear = false,
  "aria-label": ariaLabel = "Choose date",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = dateFromKey(value);
  const minDate = dateFromKey(min);
  const maxDate = dateFromKey(max);
  const disabledDays =
    minDate && maxDate
      ? { before: minDate, after: maxDate }
      : minDate
        ? { before: minDate }
        : maxDate
          ? { after: maxDate }
          : undefined;

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
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="shrink-0" />
            <span className="truncate">
              {selected ? format(selected, "PPP") : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto max-w-[calc(100vw-1.5rem)] p-0"
          align="start"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected || maxDate || new Date()}
            onSelect={(date) => {
              if (!date) return;
              onChange(keyFromDate(date));
              setOpen(false);
            }}
            disabled={disabledDays}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {allowClear && value && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Clear date"
          onClick={() => onChange("")}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  optional?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  optional = false,
  className,
  "aria-label": ariaLabel = "Choose date and time",
}: DateTimePickerProps) {
  const [day = "", time = ""] = value.split("T");
  const updateDay = (nextDay: string) =>
    onChange(nextDay ? `${nextDay}T${time || currentTimeValue()}` : "");
  const updateTime = (nextTime: string) => {
    if (!day && nextTime) return onChange("");
    onChange(day ? `${day}T${nextTime}` : "");
  };

  return (
    <div
      className={cn(
      "grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]",
        className,
      )}
      aria-label={ariaLabel}
    >
      <DatePicker
        value={day}
        onChange={updateDay}
        min={min}
        max={max}
        allowClear={optional}
        aria-label={`${ariaLabel}: date`}
      />
      <TimePicker
        value={time}
        onChange={updateTime}
        aria-label={`${ariaLabel}: time`}
      />
    </div>
  );
}
