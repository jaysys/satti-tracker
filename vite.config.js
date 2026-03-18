import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/cesium/Build/Cesium/Workers",
          dest: "cesiumStatic",
        },
        {
          src: "node_modules/cesium/Build/Cesium/Assets",
          dest: "cesiumStatic",
        },
        {
          src: "node_modules/cesium/Build/Cesium/ThirdParty",
          dest: "cesiumStatic",
        },
        {
          src: "node_modules/cesium/Build/Cesium/Widgets",
          dest: "cesiumStatic",
        },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesiumStatic"),
  },
  server: {
    port: 6004,
    proxy: {
      "/api": {
        target: "http://localhost:60041",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
