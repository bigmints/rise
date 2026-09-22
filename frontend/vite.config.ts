import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "rise-login-route",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.split("?")[0] === "/login")
            request.url = "/login.html";
          next();
        });
      },
    },
  ],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  publicDir: false,
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${process.env.RISE_PORT || "8787"}`,
      "/quick-checkin": `http://127.0.0.1:${process.env.RISE_PORT || "8787"}`,
      "/manifest.webmanifest": `http://127.0.0.1:${process.env.RISE_PORT || "8787"}`,
      "/icon-192.png": `http://127.0.0.1:${process.env.RISE_PORT || "8787"}`,
      "/icon-512.png": `http://127.0.0.1:${process.env.RISE_PORT || "8787"}`,
    },
  },
  build: {
    outDir: "../static",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        login: resolve(import.meta.dirname, "login.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/shared-[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
