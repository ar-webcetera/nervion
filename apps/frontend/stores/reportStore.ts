import { defineStore } from 'pinia';
import type { Employee } from '~/types/user';

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

  return { unloadReport, fetchPreview };
});
