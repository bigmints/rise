import type { HealthHistoryPoint, HealthResult } from "@/types";

export const HEALTH_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "liver", label: "Liver" },
  { id: "blood_sugar", label: "Blood sugar" },
  { id: "lipids", label: "Cholesterol & fats" },
  { id: "kidney", label: "Kidney" },
  { id: "inflammation", label: "Inflammation" },
  { id: "blood_count", label: "Blood count" },
  { id: "immune", label: "Immune markers" },
  { id: "minerals", label: "Minerals" },
  { id: "urine", label: "Urine" },
  { id: "body", label: "Body measurements" },
] as const;

export function categoryForKey(key: string) {
  if (["alt", "ast"].includes(key)) return "liver";
  if (key.startsWith("glucose_") || key === "hba1c") return "blood_sugar";
  if (key.startsWith("cholesterol_") || key.startsWith("triglycerides")) return "lipids";
  if (key.startsWith("creatinine") || ["egfr", "urea", "uric_acid"].includes(key) || key.startsWith("urea") || key.startsWith("uric_acid")) return "kidney";
  if (["crp", "esr"].includes(key)) return "inflammation";
  if (["wbc", "rbc", "haemoglobin", "haematocrit", "mcv", "mch", "mchc", "platelets", "rdw", "neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils"].some((item) => key === item || key === `absolute_${item}`)) return "blood_count";
  if (["rheumatoid_factor", "hla_b27", "anti_ccp"].includes(key)) return "immune";
  if (key.startsWith("calcium")) return "minerals";
  if (key.startsWith("urine_")) return "urine";
  if (key.startsWith("prescription_")) return "body";
  return "all";
}

export type HealthSeries = {
  key: string;
  name: string;
  category: string;
  points: HealthHistoryPoint[];
  latest: HealthHistoryPoint;
  previous?: HealthHistoryPoint;
};

export function buildHealthSeries(histories: Record<string, HealthHistoryPoint[]>, resultLookup: Map<string, HealthResult>) {
  return Object.entries(histories).map(([key, rawPoints]) => {
    const points = [...rawPoints].sort((a, b) => a.report_date.localeCompare(b.report_date));
    const result = resultLookup.get(key);
    return {
      key,
      name: result?.name || key.replaceAll("_", " "),
      category: categoryForKey(key),
      points,
      latest: points[points.length - 1],
      previous: points.length > 1 ? points[points.length - 2] : undefined,
    } satisfies HealthSeries;
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
