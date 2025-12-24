// lib/env.js

export function mustGetEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v);
}

export function getEnv(name, fallback = "") {
  const v = process.env[name];
  if (!v || !String(v).trim()) return fallback;
  return String(v);
}
