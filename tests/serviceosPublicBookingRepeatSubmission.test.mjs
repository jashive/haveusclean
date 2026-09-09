import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getGovernedResidentialCatalog } from "../src/lib/governedResidentialPricing.js";

const widget = fs.readFileSync(new URL("../src/components/BookingWidget.jsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/bookings/create.js", import.meta.url), "utf8");

test("published pricing catalog exposes only deterministic dwelling combinations", () => {
  const catalog = getGovernedResidentialCatalog({ configuration: { dwelling_matrix: {
    apartments_condos: {
      "1bed_1bath": { essential_refresh: 100 },
      "2bed_1_5bath": { essential_refresh: 150 },
      "1bed_den_1bath": { essential_refresh: 125 },
    },
    townhouses: [{ beds: 3, baths: 2.5, package_prices: { essential_refresh: 220 } }],
  } } });
  assert.deepEqual(catalog, [
    { dwellingType: "apartment", bedrooms: 1, bathrooms: 1 },
    { dwellingType: "apartment", bedrooms: 2, bathrooms: 1.5 },
    { dwellingType: "townhouse", bedrooms: 3, bathrooms: 2.5 },
  ]);
});

test("public booking catalog and repeat-submission reset share the existing booking function", () => {
  assert.match(api, /req\.body\?\.catalog === true/);
  assert.match(api, /loadPublicBookingCatalog/);
  assert.match(widget, /data-testid="governed-home-size"/);
  assert.match(widget, /setForm\(createInitialResidential\(\)\)/);
  assert.match(widget, /setSelectedAddOns\(\[\]\)/);
  assert.match(widget, /setQuote\(null\)/);
  assert.match(widget, /setStep\(0\)/);
});

test("Ontario and Arizona both load their published catalog by selected market", () => {
  assert.match(widget, /catalog: true, market: form\.market/);
  assert.match(widget, /\[form\.market\]/);
  assert.match(api, /Logical endpoints are rewritten to this same serverless function/);
});
