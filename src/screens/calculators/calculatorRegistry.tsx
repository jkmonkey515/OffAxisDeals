import React from 'react';
import MaoCalculatorScreen from './MaoCalculatorScreen';
import CashflowCalculatorScreen from './CashflowCalculatorScreen';
import MortgageCalculatorScreen from './MortgageCalculatorScreen';
import CapRateCalculatorScreen from './CapRateCalculatorScreen';
import CashOnCashCalculatorScreen from './CashOnCashCalculatorScreen';
import ClosingCostsCalculatorScreen from './ClosingCostsCalculatorScreen';
import HoldingCostsCalculatorScreen from './HoldingCostsCalculatorScreen';
import FlipProfitCalculatorScreen from './FlipProfitCalculatorScreen';
import WholesaleSplitCalculatorScreen from './WholesaleSplitCalculatorScreen';
import RehabEstimatorCalculatorScreen from './RehabEstimatorCalculatorScreen';
import RentVsSellCalculatorScreen from './RentVsSellCalculatorScreen';
import BuyRehabRentRefiRepeatCalculatorScreen from './BuyRehabRentRefiRepeatCalculatorScreen';

export type CalculatorKey =
  | 'mao'
  | 'cashflow'
  | 'cap_rate'
  | 'cash_on_cash'
  | 'brrrr'
  | 'flip_profit'
  | 'rehab'
  | 'wholesale_split'
  | 'closing_costs'
  | 'holding_costs'
  | 'rent_vs_sell'
  | 'mortgage';

export interface CalculatorEntry {
  title: string;
  description: string;
  component?: React.ComponentType;
}

export const CALCULATOR_REGISTRY: Record<CalculatorKey, CalculatorEntry> = {
  mao: {
    title: 'MAO Calculator',
    description: 'Calculate Maximum Allowable Offer for your deals',
    component: MaoCalculatorScreen,
  },
  cashflow: {
    title: 'Cashflow / ROI',
    description: 'Calculate rental income, cash flow, and return on investment',
    component: CashflowCalculatorScreen,
  },
  cap_rate: {
    title: 'Cap Rate Calculator',
    description: 'Calculate capitalization rate for investment properties',
    component: CapRateCalculatorScreen,
  },
  cash_on_cash: {
    title: 'Cash on Cash Return',
    description: 'Calculate cash-on-cash return on investment',
    component: CashOnCashCalculatorScreen,
  },
  brrrr: {
    title: 'Buy • Rehab • Rent • Refi • Repeat',
    description: 'Snapshot for buy→rehab→rent→refi cycles',
    component: BuyRehabRentRefiRepeatCalculatorScreen,
  },
  flip_profit: {
    title: 'Flip Profit Calculator',
    description: 'Calculate profit and ROI for house flipping deals',
    component: FlipProfitCalculatorScreen,
  },
  rehab: {
    title: 'Rehab Estimator',
    description: 'Estimate renovation costs and timelines',
    component: RehabEstimatorCalculatorScreen,
  },
  wholesale_split: {
    title: 'Wholesale Fee Split',
    description: 'Calculate fee splits for wholesale deals',
    component: WholesaleSplitCalculatorScreen,
  },
  closing_costs: {
    title: 'Closing Costs Calculator',
    description: 'Estimate closing costs for real estate transactions',
    component: ClosingCostsCalculatorScreen,
  },
  holding_costs: {
    title: 'Holding Costs Calculator',
    description: 'Calculate monthly holding costs during renovation',
    component: HoldingCostsCalculatorScreen,
  },
  rent_vs_sell: {
    title: 'Rent vs Sell Calculator',
    description: 'Compare rental income vs selling proceeds',
    component: RentVsSellCalculatorScreen,
  },
  mortgage: {
    title: 'Mortgage Calculator',
    description: 'Calculate monthly mortgage payments and amortization',
    component: MortgageCalculatorScreen,
  },
};
