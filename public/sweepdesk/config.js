/* Sweep Desk — team server configuration.
 *
 * SWEEPDESK_API is the base URL of the deployment that hosts the shared-state
 * API (the Vercel deployment of this repo). Leave it '' when this page is
 * served BY that same deployment (e.g. https://your-app.vercel.app/sweepdesk/)
 * — same-origin requests need no absolute URL.
 *
 * For the copies served from GitHub Pages / Cloudflare Pages, set this to the
 * Vercel URL, e.g.:  window.SWEEPDESK_API = 'https://your-app.vercel.app';
 * so all three sites read and write the SAME shared data.
 *
 * You can also override per-browser without editing this file by opening the
 * site once with  ?api=https://your-app.vercel.app  in the address bar.
 *
 * SWEEPDESK_KEY is only needed if you set the SWEEPDESK_KEY environment
 * variable on the API deployment (a shared passphrase the API requires).
 */
window.SWEEPDESK_API = '';
window.SWEEPDESK_KEY = '';
