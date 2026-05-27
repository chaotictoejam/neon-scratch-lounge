import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neon: {
          teal: "#00ffcc",
          pink: "#ff00aa",
          amber: "#ffaa00",
          purple: "#6644aa",
        },
        dark: {
          bg: "#0a0a0f",
          panel: "#0d0d18",
          inset: "#080810",
          border: "#1a1a2e",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "blink": "blink 1s step-end infinite",
        "flash-amber": "flashAmber 2s ease-in-out",
        "flash-red": "flashRed 0.5s ease-in-out",
        "glow-teal": "glowTeal 2s ease-in-out infinite alternate",
        "spin-slow": "spin 3s linear infinite",
        "count-up": "countUp 0.6s ease-out",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        flashAmber: {
          "0%": { backgroundColor: "transparent" },
          "20%": { backgroundColor: "rgba(255,170,0,0.3)" },
          "80%": { backgroundColor: "rgba(255,170,0,0.3)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashRed: {
          "0%": { backgroundColor: "transparent" },
          "50%": { backgroundColor: "rgba(255,0,60,0.3)" },
          "100%": { backgroundColor: "transparent" },
        },
        glowTeal: {
          "0%": { boxShadow: "0 0 5px #00ffcc44" },
          "100%": { boxShadow: "0 0 20px #00ffcc88, 0 0 40px #00ffcc44" },
        },
        countUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      boxShadow: {
        teal: "0 0 8px #00ffcc66, 0 0 1px #00ffcc",
        pink: "0 0 8px #ff00aa66, 0 0 1px #ff00aa",
        amber: "0 0 8px #ffaa0066, 0 0 1px #ffaa00",
        red: "0 0 8px #ff003c66, 0 0 1px #ff003c",
      },
    },
  },
  plugins: [],
};

export default config;
