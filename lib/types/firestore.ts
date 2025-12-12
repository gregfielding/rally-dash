import { Timestamp } from "firebase/firestore";

export interface League {
  id?: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Team {
  id?: string;
  leagueId: string;
  name: string;
  slug: string;
  city: string;
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  keywords: string[];
  bannedTerms: string[];
  notes?: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Product {
  id?: string;
  name: string;
  skuPrefix: string;
  printArea: {
    widthIn: number;
    heightIn: number;
    dpi: number;
    x: number;
    y: number;
  };
  basePhotos?: {
    flatLayUrl?: string;
    hangerUrl?: string;
  };
  mockupTemplateId?: string;
  variants?: Array<{
    name: string;
    type: "color" | "size";
    values: string[];
  }>;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

