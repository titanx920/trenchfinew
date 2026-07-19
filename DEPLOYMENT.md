# Sweep Desk — Deployment Guide

Sweep Desk lives in this repo at `public/sweepdesk/` (static app) plus a
shared-state API at `src/app/api/sweepdesk/state/route.js` (Next.js + MongoDB).

## How the three platforms fit together

```
                 git push to GitHub  (source of truth)
                          │
        ┌─────────────────┼─────────────────────┐
        ▼                 ▼                     ▼
   Vercel            GitHub Pages         Cloudflare Pages
 (full Next.js       (static copy of      (static copy of
  app + THE API       public/sweepdesk)    public/sweepdesk)
  + MongoDB)               │                     │
        ▲                  └──────► both point their sync layer
        └─────────────────────────  at the Vercel API URL
```

- **Vercel** runs the whole Next.js app, including `/sweepdesk/` **and** the
  shared-state API backed by MongoDB. This is the one deployment that makes
  multi-user work — everyone's changes are saved there and every open browser
  polls it every 15 seconds.
- **GitHub Pages** and **Cloudflare Pages** serve static copies of the same
  app. They deploy automatically from GitHub Actions on every push. Their
  copies talk to the Vercel API (set once in `public/sweepdesk/config.js`),
  so all three URLs show the same live team data.
- Any change you commit and push to GitHub lands on all three automatically.

## One-time setup

### 1. Vercel (do this first — it hosts the API)

1. Go to <https://vercel.com/new>, import the `titanx920/trenchfinew` GitHub
   repo, framework preset **Next.js**, and deploy.
2. In the Vercel project → **Settings → Environment Variables**, add:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — any long random string (used by the existing trenchfinew auth)
   - `SWEEPDESK_KEY` — *(optional)* a shared passphrase; if set, the Sweep Desk
     API rejects requests that don't present it (see `config.js`)
3. Redeploy after adding the variables. Sweep Desk is now at
   `https://<your-project>.vercel.app/sweepdesk/`.

Vercel's GitHub integration auto-deploys every push — nothing else needed.

### 2. Point the static copies at the API

Edit `public/sweepdesk/config.js` and set:

```js
window.SWEEPDESK_API = 'https://<your-project>.vercel.app';
```

Commit and push. (Until you do this, the GitHub Pages / Cloudflare copies run
in local-only mode; the Vercel copy works immediately because it is
same-origin with the API.)

Quick test without editing the file: open any copy with
`?api=https://<your-project>.vercel.app` appended to the URL once — the
setting sticks in that browser.

### 3. GitHub Pages

1. Repo → **Settings → Pages → Build and deployment → Source**: choose
   **GitHub Actions**.
2. Push any change under `public/sweepdesk/` (or run the
   **Deploy Sweep Desk to GitHub Pages** workflow manually from the Actions
   tab). The site appears at `https://titanx920.github.io/trenchfinew/`.

### 4. Cloudflare Pages

1. In the Cloudflare dashboard create an API token with the
   **Cloudflare Pages — Edit** permission, and note your Account ID.
2. Repo → **Settings → Secrets and variables → Actions** → add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Push (or run the **Deploy Sweep Desk to Cloudflare Pages** workflow). The
   first run creates the `sweep-desk` Pages project; the site appears at
   `https://sweep-desk.pages.dev`.

Until the secrets exist the workflow skips itself with a notice — it won't
fail your pushes.

## Multi-user model

- Everyone signs in with their own name + PIN (managed on the Admin page,
  seeded from `setup.json`).
- All data — uploaded reports, pass levels, "worked today" checkmarks, manager
  notes, time off, settings — syncs through the API. Changes appear on other
  screens within ~15 seconds.
- Concurrent edits are merged: the server keeps a version number, and each
  browser re-merges its unsaved changes on conflict instead of overwriting
  other people's work.
- If the API is unreachable, the app falls back to browser-local storage and
  re-syncs when the server is back.

**Security honesty:** PINs are a courtesy gate, not real authentication — they
are visible in the app's source/state. Anyone with the site URL (and the
`SWEEPDESK_KEY`, if set) can read the shared data. Set `SWEEPDESK_KEY` on
Vercel and in `config.js` to keep casual visitors out, and treat the URLs as
internal.

## Environment variables (Vercel)

| Name | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB Atlas connection string |
| `JWT_SECRET` | yes | existing trenchfinew auth |
| `SWEEPDESK_KEY` | no | shared passphrase required by the Sweep Desk API |
| `SWEEPDESK_ALLOWED_ORIGIN` | no | lock CORS to one origin (default `*`) |

## ⚠️ Rotate the exposed credentials

A previous commit added `.env.local` — containing a live MongoDB password and
JWT secret — to git history, which is public on GitHub. The file is no longer
tracked, but **history still contains it**. Do this now:

1. **MongoDB Atlas** → Database Access → edit the `ufree611` user → set a new
   password (or create a new user and delete the old one). Update
   `MONGODB_URI` on Vercel and in your local `.env.local`.
2. **JWT secret** — pick a new long random string for `JWT_SECRET` on Vercel
   and locally (existing sessions will need to log in again).
3. Optionally scrub git history (`git filter-repo`) — ask if you want this
   done; it rewrites history and force-pushes, so it needs your go-ahead.
