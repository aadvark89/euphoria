# ETH Stability — Tap Trading Risk Dashboard

Historical ETH volatility analysis + live AI risk assessment for Euphoria Finance tap trading.

## Deploy to Vercel

### Option 1: Vercel CLI (fastest)
```bash
npm i -g vercel
cd eth-risk-dashboard
vercel --prod
```

### Option 2: Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your repo
4. Framework preset: **Other** (static site)
5. Deploy — done, no build step needed

### Option 3: Drag & Drop
1. Zip the entire `eth-risk-dashboard` folder
2. Go to [vercel.com/new](https://vercel.com/new)
3. Drag the zip into the deploy area

## Files
```
eth-risk-dashboard/
├── index.html      # Main page
├── style.css       # Styles (dark quant aesthetic)
├── app.js          # Charts, risk engine, AI integration
├── vercel.json     # Vercel config
└── README.md
```

## Features
- **Volatility heatmap** — Garman-Klass by hour × day of week
- **24h bar chart** — Average hourly vol profile
- **Stability score chart** — Current UTC hour highlighted live
- **Live risk meters** — 4-factor composite score, auto-refreshes
- **AI analysis** — Claude Sonnet 4 reads current conditions
- **Timezone converter** — Shows prime windows in your local time
- **Ranked windows table** — All 6 windows scored and explained

## AI Integration
The AI analysis calls the Anthropic API directly from the browser. No backend required. The API key is handled by Anthropic's infrastructure when accessed via claude.ai. If deploying standalone, you'll need to add a backend proxy to avoid exposing your API key.

## Data Sources
- Amberdata hourly crypto volatility research (2018–2023)
- Academic paper: "Forecasting Ethereum's volatility" (GK estimator, 5-min sampling)
- Trading session data from multiple institutional sources
