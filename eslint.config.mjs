import js from "@eslint/js";

const browserGlobals = {
  Blob: "readonly",
  FormData: "readonly",
  URL: "readonly",
  chrome: "readonly",
  console: "readonly",
  crypto: "readonly",
  document: "readonly",
  fetch: "readonly",
  prompt: "readonly",
  setTimeout: "readonly",
  window: "readonly",
};

const testGlobals = {
  ...browserGlobals,
  globalThis: "readonly",
  process: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: testGlobals,
      sourceType: "module",
    },
  },
];
