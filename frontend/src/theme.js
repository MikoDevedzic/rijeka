// theme.js — the Harbour tokens (src/index.css :root) for code that draws on a canvas, where a CSS variable
// cannot be read as a colour and a hex gets an alpha by appending two digits. One name per token; theme.test.js
// holds every value here to the stylesheet, so the two cannot drift.
export const T = {
  bg: '#0b1d1a', bgDeep: '#081714', panel: '#102723', panel2: '#16332d', panel3: '#1d4039',
  border: '#24372f', borderHi: '#43544a', borderGlow: '#5f7165',
  text: '#e9e3d3', textHi: '#f6f1e4', textDim: '#a9b9ae', textMute: '#8a9f94', textFaint: '#6f877d',
  accent: '#d9b25c', accentHi: '#f1d488', accentDim: '#7d6731', accentInk: '#1b1403',
  up: '#8fe0ae', down: '#f09382', amber: '#e9975a', blue: '#8fc1e6', purple: '#c0a5ee', cyan: '#7fd3cc', chain: '#f1d488',
}
// "r g b" of a token's hex, for rgb(… / alpha)
export const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')
export const alpha = (hex, a) => `rgb(${rgb(hex)} / ${a})`
export const MONO = "'DM Mono', ui-monospace, monospace"
