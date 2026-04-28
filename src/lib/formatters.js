import { REGIONS } from "./constants";

export const getDefaultRegion = () => REGIONS.ON;

export const fmt = (amount, region = getDefaultRegion()) =>
  new Intl.NumberFormat(region.locale, {
    style: "currency",
    currency: region.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

export const fmtC = (amount, region = getDefaultRegion()) =>
  new Intl.NumberFormat(region.locale, {
    style: "currency",
    currency: region.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
