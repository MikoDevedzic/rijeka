// trade-window/Figures.jsx
// A sentence with figures in it, the figures set as figures (mono), the words as they are: the line a form writes
// once it has done something ("Reduced from 10,000,000 to 4,000,000 USD", "Amended: FIXED RATE 3.48 → 3.55 %").
const FIGURE = /(-?\d[\d,]*(?:\.\d+)?)/

export default function Figures({ text }) {
  if (!text) return null
  return String(text).split(FIGURE).map((part, i) => (i % 2 ? <span key={i} className="tbw-mono">{part}</span> : part))
}
