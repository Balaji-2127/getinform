// Vercel rejects any request body over 4.5 MB before it reaches the API, with
// a plain-text error the upload forms can't read. Checking the file here
// first means an oversized sheet gets a clear message instead. Matches the
// server's own multer limit (server/routes/campaigns.ts).
export const MAX_SHEET_BYTES = 4 * 1024 * 1024;

export const SHEET_TOO_LARGE =
  "That sheet is over 4 MB. Delete the property rows you're not pitching (or any extra tabs) and upload it again.";
