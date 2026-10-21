import { loadEnvFile } from "node:process";

// This project keeps frontend variables separate from backend secrets.
loadEnvFile(new URL(".env.frontend", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Emits .next/standalone (server.js + only the node_modules it needs) for
  // the Cloud Run image -- see Dockerfile. `next dev` ignores it.
  output: 'standalone',
};

export default nextConfig;
