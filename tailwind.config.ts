import type { Config } from "tailwindcss";

// Head Above Digital brand (the website's Brand Kit), used by the CRM and client portal too:
// forest green #1F3B2D / #173022, cream #EFE6D4, gold #D8B47A / #A87A33, brown #6B5A43, rust #A8401F.
// "dawn" is the brand accent scale; "slate" is replaced by warm neutrals so every grey in the CRM
// and portal sits with the brand.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dawn: {
          50: "#F7F2E8",
          100: "#EFE6D4",
          400: "#D8B47A",
          500: "#A87A33",
          600: "#1F3B2D",
          700: "#173022",
          900: "#173022",
        },
        slate: {
          50: "#FAF7F1",
          100: "#F2ECE0",
          200: "#E4DAC7",
          300: "#CFC2A8",
          400: "#A6967A",
          500: "#7D6C55",
          600: "#6B5A43",
          700: "#4C4031",
          800: "#2C3A30",
          900: "#1F3B2D",
        },
      },
      fontFamily: {
        sans: ["Barlow", "Helvetica", "Arial", "sans-serif"],
        condensed: ["Barlow Condensed", "Arial Narrow", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
