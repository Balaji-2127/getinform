// Vercel serverless entry for the API. Every /api/* request is rewritten
// here (vercel.json) and handed to the same Express app the long-running
// server uses. It imports the compiled server (dist-server/), which
// `npm run build` produces before Vercel bundles this function.
import app from "../dist-server/app.js";

export default app;
