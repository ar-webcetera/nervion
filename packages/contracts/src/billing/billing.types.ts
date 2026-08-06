import type { BillingReviewStatus, RevenueSourceType } from "./billing.enums";

export interface RevenueSummaryItem {
  key: "today" | "yesterday" | "currentWeek" | "currentMonth" | "previousMonth";
  label: string;
  amount: number;
}

export interface RevenueBreakdownItem {
  label: string;
  amount: number;
}

export interface RevenueDashboard {
  summary: RevenueSummaryItem[];
  daily: RevenueBreakdownItem[];
  projects: RevenueBreakdownItem[];
  actual: number;
  pending: number;
  openFixed: number;
  potential: number;
  target: number;
}

export interface BillingQueueItem {
  id: number;
  sourceType: RevenueSourceType;
  status: BillingReviewStatus;
  project: string;
  task: string;
  executor: string | null;
  summary: string | null;
  seconds: number | null;
  rate: number | null;
  amount: number;
  occurredAt: string;
  recognizedAt: string;
}
