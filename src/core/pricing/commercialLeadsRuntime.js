import {
  COM_ADDONS,
  COM_FREQ_DISCOUNTS,
  COM_SERVICE_COST_PER_SQFT,
  PARTNER_COST_PER_HOUR,
} from "../../lib/pricing";

export function buildCommercialLeadsRuntime({
  C,
  S,
  ModalComponent,
  QuoteBoxComponent,
  calculateQuote,
  brand,
  leadMobileActionsRow,
  leadMobileActionBtn,
  markupFactor,
}) {
  return {
    C,
    S,
    ModalComponent,
    QuoteBoxComponent,
    calculateQuote,
    COM_ADDONS,
    COM_SERVICE_COST_PER_SQFT,
    COM_FREQ_DISCOUNTS,
    BRAND: brand,
    PARTNER_COST_PER_HOUR,
    LEAD_MOBILE_ACTIONS_ROW: leadMobileActionsRow,
    LEAD_MOBILE_ACTION_BTN: leadMobileActionBtn,
    markupFactor,
  };
}
