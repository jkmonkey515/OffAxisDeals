/**
 * Known Deal Constraints for Post Deal and Edit Deal flows.
 * Step A parity: multi-select options stored as string array in listings.deal_constraints.
 */

export const DEAL_CONSTRAINT_OPTIONS = [
  { value: 'occupied', label: 'Occupied' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'double_close', label: 'Double Close' },
  { value: 'non_refundable_emd', label: 'Non-refundable EMD' },
  { value: 'limited_inspection', label: 'Limited Inspection' },
  { value: 'access_restrictions', label: 'Access Restrictions' },
  { value: 'title_issues_known', label: 'Title Issues Known' },
  { value: 'hoa_involved', label: 'HOA Involved' },
] as const;

export type DealConstraintValue =
  | 'occupied'
  | 'assignment'
  | 'double_close'
  | 'non_refundable_emd'
  | 'limited_inspection'
  | 'access_restrictions'
  | 'title_issues_known'
  | 'hoa_involved';

export const DEAL_CONSTRAINT_VALUES: DealConstraintValue[] = DEAL_CONSTRAINT_OPTIONS.map(
  (o) => o.value
);
