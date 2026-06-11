import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the static build works on GitHub Pages subpaths,
  // Vercel, Cloudflare Pages, and Hugging Face Spaces without config.
  base: "./",
  plugins: [react(), tailwindcss()],
});
