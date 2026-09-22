import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    color?: string;
  }
>;

type ChartContextValue = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextValue | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used inside ChartContainer");
  return context;
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  }
>(({ className, children, config, ...props }, ref) => (
  <ChartContext.Provider value={{ config }}>
    <div
      ref={ref}
      className={cn(
        "flex min-h-0 min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
        className,
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  </ChartContext.Provider>
));
ChartContainer.displayName = "ChartContainer";

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  payload?: Record<string, unknown>;
};

type ChartTooltipContentProps = React.ComponentProps<"div"> & {
  active?: boolean;
  hideLabel?: boolean;
  label?: React.ReactNode;
  labelFormatter?: (
    label: React.ReactNode,
    payload: readonly TooltipPayloadItem[],
  ) => React.ReactNode;
  payload?: readonly TooltipPayloadItem[];
  valueFormatter?: (
    value: TooltipPayloadItem["value"],
    name: string,
    item: TooltipPayloadItem,
  ) => React.ReactNode;
};

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipContentProps
>(
  (
    {
      active,
      className,
      hideLabel = false,
      label,
      labelFormatter,
      payload,
      valueFormatter,
    },
    ref,
  ) => {
    const { config } = useChart();
    if (!active || !payload?.length) return null;

    const displayLabel = labelFormatter ? labelFormatter(label, payload) : label;

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-32 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl",
          className,
        )}
      >
        {!hideLabel && displayLabel ? (
          <div className="font-medium">{displayLabel}</div>
        ) : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = String(item.dataKey ?? item.name ?? index);
            const itemConfig = config[key];
            const name = String(itemConfig?.label ?? item.name ?? key);
            return (
              <div
                key={`${key}-${index}`}
                className="flex min-w-0 items-center justify-between gap-4"
              >
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: item.color ?? itemConfig?.color }}
                  />
                  <span className="truncate">{name}</span>
                </div>
                <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">
                  {valueFormatter
                    ? valueFormatter(item.value, name, item)
                    : String(item.value ?? "—")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = "ChartTooltipContent";

type LegendPayloadItem = {
  color?: string;
  dataKey?: string | number;
  value?: string | number;
};

type ChartLegendContentProps = React.ComponentProps<"div"> & {
  payload?: readonly LegendPayloadItem[];
};

const ChartLegendContent = React.forwardRef<HTMLDivElement, ChartLegendContentProps>(
  ({ className, payload }, ref) => {
    const { config } = useChart();
    if (!payload?.length) return null;
    return (
      <div ref={ref} className={cn("flex items-center justify-center gap-4", className)}>
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.value);
          return (
            <div key={key} className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: item.color ?? config[key]?.color }}
              />
              {config[key]?.label ?? item.value}
            </div>
          );
        })}
      </div>
    );
  },
);
ChartLegendContent.displayName = "ChartLegendContent";

const ChartTooltip = RechartsPrimitive.Tooltip;
const ChartLegend = RechartsPrimitive.Legend;

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
};
