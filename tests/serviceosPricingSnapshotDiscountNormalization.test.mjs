import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeGovernedResidentialQuote } from '../src/lib/governedResidentialPricing.js';

const config = {
  id: 'cfg-on-test',
  business_unit_id: 'bu-on',
  jurisdiction_id: 'jur-on',
  configuration_type: 'residential_pricing',
  version: 'ON-TEST',
  configuration: {
    currency_code: 'CAD',
    tax: { rate: 0.13, label: 'HST' },
    minimum_charge: { general_residential: 200 },
    dwelling_matrix: {
      semi_detached_detached: {
        '4bed_3bath': { package_prices: { complete_deep: 500 } },
      },
    },
    square_footage_adjustments: {
      additional_250_500_sqft: { minimum: 50, maximum: 50 },
    },
    recurring_service: {
      weekly_discount: { min: 0.1, max: 0.1 },
    },
  },
};

test('Mississauga-style surcharge is not misclassified as a negative discount', () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: config,
    dwellingType: 'detached_house',
    beds: 4,
    baths: 3,
    packageKey: 'complete_deep',
    condition: 'light',
    frequency: 'one_time',
    addons: [],
    approvedSelections: {
      sqftBand: 'additional_250_500_sqft',
      sqftAdjustmentAmount: 50,
    },
  });
  assert.equal(quote.preTaxTotal, 550);
  assert.equal(quote.discountAmt, 0);
  assert.equal(quote.discPct, 0);
});

test('recurring discount is calculated from the surcharge-adjusted subtotal', () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: config,
    dwellingType: 'detached_house',
    beds: 4,
    baths: 3,
    packageKey: 'complete_deep',
    condition: 'light',
    frequency: 'weekly',
    addons: [],
    approvedSelections: {
      sqftBand: 'additional_250_500_sqft',
      sqftAdjustmentAmount: 50,
      recurringDiscountPct: 0.1,
    },
  });
  assert.equal(quote.preTaxTotal, 495);
  assert.equal(quote.discountAmt, 55);
  assert.equal(quote.discPct, 0.1);
});

test('all quote revision pricing paths explicitly normalize discount amount and percentage to non-negative values', async () => {
  const source = await readFile(new URL('../src/features/wave1/ServiceOSQuoteRevisionPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /function nonNegativeMoney\(value\)/);
  assert.match(source, /function nonNegativeRate\(value\)/);
  assert.match(source, /discount_amount:\s*nonNegativeMoney\(nonNegativeMoney\(quote\.discountAmt\) \+ nonNegativeMoney\(concessionAmount\)\)/);
  assert.match(source, /discountAmount:\s*nonNegativeMoney\(nonNegativeMoney\(quote\.discountAmt\) \+ nonNegativeMoney\(concessionAmount\)\)/);
  assert.match(source, /discountPct:\s*nonNegativeRate\(quote\.discPct \?\? 0\)/);
});
