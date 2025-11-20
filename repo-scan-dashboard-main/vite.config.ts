import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  preview: {
    host: "::",
    port: 4173,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // Quita console.* y debugger en build prod para reducir JS y TBT
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: { polyfill: true },
    reportCompressedSize: true,
    target: "es2022",
  },
}));
