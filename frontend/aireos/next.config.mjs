import { loadEnvFile } from "node:process";

// This project keeps frontend variables separate from backend secrets.
loadEnvFile(new URL(".env.frontend", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
