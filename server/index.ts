import app from "./app.js";

// Long-running server entry: local dev (`npm run dev`) and Render
// (`npm start`). On Vercel, api/index.js serves the same app instead.
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
