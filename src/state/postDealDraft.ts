import type { SupportedCurrency } from '../utils/currency';

interface SelectedImage {
  uri: string;
}

export interface PostDealDraft {
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  lotSqft: string;
  description: string;
  selectedImages: SelectedImage[];
  coverIndex: number | null;
  latitude: number | null;
  longitude: number | null;
  arv?: string;
  repairs?: string;
  yearBuilt?: string;
  garageSpaces?: string;
  currency?: SupportedCurrency;
  propertyType?: string | null;
  dealConstraints?: string[];
  dealConstraintsNotes?: string;
}

// Module-scoped draft storage
let draft: PostDealDraft | null = null;

export function getPostDealDraft(): PostDealDraft | null {
  return draft;
}

export function setPostDealDraft(newDraft: PostDealDraft): void {
  draft = newDraft;
}

export function clearPostDealDraft(): void {
  draft = null;
}

