// Used only when the app is hosted on Cloudflare Pages, which cannot run timed jobs itself.
// This tiny companion Worker shares the same database and runs the daily clean-up.
import app from './worker.js';

export default {
  scheduled: app.scheduled,
  fetch: () => new Response('Not found', { status: 404 }),
};
