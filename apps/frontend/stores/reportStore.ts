import { defineStore } from 'pinia';
import type { Employee } from '~/types/user';
import { RevenueSourceType, type BillingQueueItem, type BillingReviewStatus, type RevenueDashboard } from '@tracker/contracts';

export interface TimelogRow {
  project: string;
  executor: string;
  specialization: string;
  grade: string;
  rate: number;
  taskTitle: string;
  date: string;
  summary: string;
  hours: number;
  amount: number;
}

type ReportPayload = { from: string; to: string; employees: Employee[]; project_id: number | null; executor_id: number | null };

export const useReportStore = defineStore('report', () => {
  const config = useRuntimeConfig();
  const pendingCount = ref(0);
  const dashboard = ref<RevenueDashboard | null>(null);
  const pendingItems = ref<BillingQueueItem[]>([]);
  const reviewedItems = ref<BillingQueueItem[]>([]);

  const fetchPendingCount = async () => {
    const response = await $fetch<{ count: number }>('/api/reportings/billing/count', {
      baseURL: config.public.API_URL,
      credentials: 'include',
    });
    pendingCount.value = response.count;
  };

  const fetchFinancialData = async () => {
    const [dashboardResponse, pendingResponse, reviewedResponse] = await Promise.all([
      $fetch<RevenueDashboard>('/api/reportings/revenue/dashboard', { baseURL: config.public.API_URL, credentials: 'include' }),
      $fetch<BillingQueueItem[]>('/api/reportings/billing/items', {
        baseURL: config.public.API_URL,
        credentials: 'include',
        params: { pending: true },
      }),
      $fetch<BillingQueueItem[]>('/api/reportings/billing/items', {
        baseURL: config.public.API_URL,
        credentials: 'include',
        params: { pending: false },
      }),
    ]);
    dashboard.value = dashboardResponse;
    pendingItems.value = pendingResponse;
    reviewedItems.value = reviewedResponse;
    pendingCount.value = pendingResponse.length;
  };

  const reviewItem = async (item: BillingQueueItem, status: BillingReviewStatus) => {
    const endpoint = item.sourceType === RevenueSourceType.TIMELOG ? 'timelogs' : 'fixed';
    await $fetch(`/api/reportings/billing/${endpoint}/${item.id}`, {
      method: 'PATCH',
      baseURL: config.public.API_URL,
      credentials: 'include',
      body: {
        status,
        recognizedAt: item.recognizedAt,
        ...(item.sourceType === RevenueSourceType.TIMELOG ? { rate: Number(item.rate ?? 0) } : { amount: Number(item.amount) }),
      },
    });
    await fetchFinancialData();
  };

  const saveTarget = async (year: number, month: number, amount: number) => {
    await $fetch('/api/reportings/revenue/target', {
      method: 'PATCH',
      baseURL: config.public.API_URL,
      credentials: 'include',
      body: { year, month, amount },
    });
    await fetchFinancialData();
  };

  const fetchPreview = async (payload: ReportPayload): Promise<TimelogRow[]> => {
    const response = await fetch(`${config.public.API_URL}/api/reportings/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Ошибка сервера: ${response.status}`);
    return response.json() as Promise<TimelogRow[]>;
  };

  const unloadReport = async (payload: ReportPayload) => {
    const response = await fetch(`${config.public.API_URL}/api/reportings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Ошибка сервера: ${response.status}`);
    }

    const blob = await response.blob();

    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/);
    const fileName = filenameMatch ? decodeURIComponent(filenameMatch[1]) : `report.xlsx`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return response;
  };

  return {
    unloadReport,
    fetchPreview,
    pendingCount,
    dashboard,
    pendingItems,
    reviewedItems,
    fetchPendingCount,
    fetchFinancialData,
    reviewItem,
    saveTarget,
  };
});
