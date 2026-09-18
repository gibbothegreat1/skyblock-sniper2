# Exotico Check Me fix

The old checker used `fetch()` against `https://exotico.flori.tv/?player=IGN` and then searched the returned HTML.
Exotico renders player exotic cards in the browser after page load, so those cards are not reliably present in the raw HTML response.

This version renders Exotico with headless Chromium in the Vercel server function, waits for the Exotics tab to load, then matches each requested item by item name + hex code.

## Required packages

After copying this version into your repo, from the Next.js project directory run:

```powershell
npm install @sparticuz/chromium@^131.0.1 puppeteer-core@^23.10.4
```

Commit both `package.json` and the updated `package-lock.json` produced by npm.

## Expected Check Me states

- `STILL HAS` — matching name + hex is visible in the rendered Exotico Exotics tab.
- `UNLUCKY NERD, SHIT'S SNIPED OR WIPED XD` — the player page loaded successfully but the requested matching piece(s) were not there.
- `API off, check yourself` — Exotico could not be rendered, reported an API error, or the player page never finished loading.

Rendered Exotico snapshots are cached for 60 seconds per IGN within a warm Vercel function to avoid repeatedly launching Chromium for the same player.
