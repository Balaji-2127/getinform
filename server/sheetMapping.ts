import type { CityId } from "./inventoryLookup.js";

// The master workbook has one sheet per city it covers (17 in the full
// export) — NCR is the one exception, a single map city covering three of
// the workbook's sheets (Delhi/Gurgaon/Noida), kept merged rather than
// split into three separate cities since existing campaigns already
// reference "ncr" as a city id. Every other sheet now maps 1:1. Any sheet
// not listed here is simply skipped (reported back to the uploader)
// rather than erroring.
export const SHEET_NAME_TO_CITY: Record<string, CityId> = {
  "Property List - Bengaluru": "bengaluru",
  "Property List - Hyderabad": "hyderabad",
  "Property List - Mumbai": "mumbai",
  "Property List - Delhi": "ncr",
  "Property List - Gurgaon": "ncr",
  "Property List - Noida": "ncr",
  // Genuinely part of the NCR metro, not separate cities — same
  // reasoning as Delhi/Gurgaon/Noida above. (The existing ncr.json
  // already covers these areas' properties; this just means a campaign
  // upload sheet using these exact names gets recognized instead of
  // silently skipped.)
  "Property List - Faridabad": "ncr",
  "Property List - Ghaziabad": "ncr",
  "Property List - Greater Noida": "ncr",
  "Property List - Ahmedabad": "ahmedabad",
  "Property List - Bhuvaneshwar": "bhuvaneshwar",
  "Property List - Chennai": "chennai",
  "Property List - Coimbatore": "coimbatore",
  "Property List - Indore": "indore",
  "Property List - Jaipur": "jaipur",
  "Property List - Kochi": "kochi",
  "Property List - Kolkata": "kolkata",
  "Property List - Lucknow": "lucknow",
  "Property List - Pune": "pune",
  "Property List - Tirupati": "tirupati",
  "Property List - Kanpur": "kanpur",
  "Property List - Nellore": "nellore",
  "Property List - Surat": "surat",
  "Property List - Vijaywada": "vijaywada",
  "Property List - Vishakapatnam": "vishakapatnam",
  // The source workbook has a trailing space in this one sheet's name
  // ("Chandigarh Tri ") — kept exactly as-is rather than trimmed, since
  // matching here has to be an exact string match against whatever name
  // a real uploaded workbook actually has.
  "Property List - Chandigarh Tri ": "chandigarh",
};
