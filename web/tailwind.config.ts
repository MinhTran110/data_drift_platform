import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        drift: {
          stable: "#10b981",
          warning: "#f59e0b",
          severe: "#ef4444",
        }
      },
    },
  },
  plugins: [],
};
export default config;
