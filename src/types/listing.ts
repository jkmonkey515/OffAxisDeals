/**
 * Listing types for Post Deal, Edit Deal, and Listing Details.
 * Step A parity: deal_constraints, deal_constraints_notes, address_visibility forced to 'exact'.
 */

export interface ListingDealConstraints {
  deal_constraints: string[];
  deal_constraints_notes?: string | null;
}
