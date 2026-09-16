import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// No CORS proxy needed here — the self-hosted backend (../backend/server.js)
// allows all origins already, so the frontend can call it directly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
