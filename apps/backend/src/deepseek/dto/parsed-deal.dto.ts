import type { JsonObject } from '@tracker/contracts';

export interface ParsedDealCompany {
  name: string;
  legal_name: string;
  inn: string;
  website: string;
  notes: string;
}

export interface ParsedDealContact {
  name: string;
  last_name: string;
  patronymic: string;
  position: string;
  phone: string;
  email: string;
  telegram: string;
}

export interface ParsedMailDeal {
  title: string;
  amount: number | null;
  expected_close: string | null;
  company: ParsedDealCompany | null;
  contacts: ParsedDealContact[];
  description: JsonObject;
}
