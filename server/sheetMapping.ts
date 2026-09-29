import type { CityId } from "./inventoryLookup.js";

// The master workbook has one sheet per city it covers (17 in the full
// export), but the app only supports 4 today — NCR is a single map city
// covering three of the workbook's sheets. Any sheet not listed here is
// simply skipped (reported back to the uploader) rather than erroring.
export const SHEET_NAME_TO_CITY: Record<string, CityId> = {
  "Property List - Bengaluru": "bengaluru",
  "Property List - Hyderabad": "hyderabad",
  "Property List - Mumbai": "mumbai",
  "Property List - Delhi": "ncr",
  "Property List - Gurgaon": "ncr",
  "Property List - Noida": "ncr",
};
