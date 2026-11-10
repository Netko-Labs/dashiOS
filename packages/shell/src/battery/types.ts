/** The battery's public types: a line of advice under the usage chart (lib/insights.ts writes them). */

export interface Insight {
  id: "faster" | "apps" | "discharge" | "charging" | "health" | "kept-full" | "low-power";
  tone: "warning" | "tip" | "info";
  title: string;
  detail: string;
}
