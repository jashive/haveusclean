function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function numericValue(...values) {
  const value = firstValue(...values);
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function listValue(...values) {
  const value = values.find(Array.isArray);
  return value ? [...value] : [];
}

export function buildDispatchCascade({ requirements = {}, estimateScope = {}, booking = {}, customer = {}, contact = {}, location = {}, pricingSnapshot = {}, quoteTitle = null } = {}) {
  const nestedCustomer = requirements.customer || {};
  const nestedLocation = requirements.location || {};
  const nestedScope = requirements.scope || {};
  const sourceScope = Object.keys(nestedScope).length ? nestedScope : requirements;
  const normalizedLocation = {
    address_line1: firstValue(location.address_line1, nestedLocation.address_line1, nestedLocation.address),
    address_line2: firstValue(location.address_line2, nestedLocation.address_line2, nestedLocation.unit, nestedLocation.unitApt),
    city: firstValue(location.city, nestedLocation.city),
    subdivision: firstValue(location.subdivision, nestedLocation.subdivision),
    postal_code: firstValue(location.postal_code, nestedLocation.postal_code, nestedLocation.postalCode),
    country_code: firstValue(location.country_code, nestedLocation.country_code, nestedLocation.countryCode),
    access_notes: firstValue(location.access_notes, nestedLocation.access_notes, nestedLocation.accessNotes, requirements.access_notes),
  };
  const legacyScope = {
    packageKey: firstValue(sourceScope.packageKey, sourceScope.package_key, estimateScope.packageKey, estimateScope.package_key, booking.service_package),
    dwellingType: firstValue(sourceScope.dwellingType, sourceScope.dwelling_type, sourceScope.propertyType, estimateScope.dwellingType, estimateScope.dwelling_type),
    beds: numericValue(sourceScope.beds, sourceScope.bedrooms, estimateScope.beds, estimateScope.bedrooms),
    baths: numericValue(sourceScope.baths, sourceScope.bathrooms, estimateScope.baths, estimateScope.bathrooms),
    sqft: numericValue(sourceScope.sqft, sourceScope.squareFeet, sourceScope.square_feet, estimateScope.sqft, estimateScope.square_feet),
    condition: firstValue(sourceScope.condition, estimateScope.condition),
    frequency: firstValue(sourceScope.frequency, estimateScope.frequency, booking.frequency),
    addons: listValue(sourceScope.addons, estimateScope.addons, booking.pricing_snapshot?.input?.addons),
    preferredDate: firstValue(sourceScope.preferredDate, sourceScope.requested_service_date, booking.requested_service_date),
    preferredWindow: firstValue(sourceScope.preferredWindow, sourceScope.requested_arrival_window, booking.requested_arrival_window),
    notes: firstValue(sourceScope.notes, sourceScope.customer_notes, requirements.customer_notes),
    location: normalizedLocation,
  };
  const configurationVersionId = pricingSnapshot.configuration_version_id || booking.pricing_configuration_version_id || booking.pricing_snapshot?.configuration_version_id || null;
  const definition = residentialDefinitionSnapshot(legacyScope, configurationVersionId);
  const scope = adaptLegacyResidentialScope(legacyScope);
  const customerSnapshot = {
    name: firstValue(customer.display_name, nestedCustomer.name, [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()),
    email: firstValue(contact.email, nestedCustomer.email),
    phone: firstValue(contact.phone, nestedCustomer.phone),
  };
  const pricing = {
    pricing_snapshot_id: pricingSnapshot.id || null,
    currency_code: firstValue(pricingSnapshot.currency_code, booking.currency_code),
    tax_name: firstValue(pricingSnapshot.tax_name, booking.tax_name),
    tax_rate: numericValue(pricingSnapshot.tax_rate, booking.tax_rate),
    subtotal_amount: numericValue(pricingSnapshot.subtotal_amount, booking.estimated_subtotal),
    tax_amount: numericValue(pricingSnapshot.tax_amount, booking.estimated_tax),
    total_amount: numericValue(pricingSnapshot.total_amount, booking.estimated_total),
    configuration_version_id: configurationVersionId,
  };
  return {
    customer: customerSnapshot,
    location: normalizedLocation,
    scope,
    pricing,
    customerInstructions: { ...customerSnapshot, notes: scope.notes || "" },
    accessInstructions: { notes: normalizedLocation.access_notes || "" },
    serviceDefinition: definition,
    checklist: { package: scope.packageKey || quoteTitle || "", service_family: "residential", addons: scope.addons, ...definition.checklist_contract },
    evidenceRequirements: definition.qa_evidence_contract.requirements,
  };
}
import { adaptLegacyResidentialScope, residentialDefinitionSnapshot } from "../core/serviceDefinitions/serviceDefinitionContract.js";
