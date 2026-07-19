import connectToDatabase from '@/lib/mongodb';
import SweepState from '@/models/SweepState';
import seed from '@/data/sweepdesk-setup.json';

// Shared-state endpoint for the Sweep Desk app (public/sweepdesk).
// One versioned document; optimistic concurrency: PUT with the last seen
// version, a stale version gets 409 + the current document to merge against.

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': process.env.SWEEPDESK_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sweep-Key',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// Optional shared passphrase: set SWEEPDESK_KEY in the environment to require
// it. The key may arrive as a header or (for sendBeacon) a query parameter.
function authorized(req) {
  const key = process.env.SWEEPDESK_KEY;
  if (!key) return true;
  if (req.headers.get('x-sweep-key') === key) return true;
  return new URL(req.url).searchParams.get('key') === key;
}

async function getOrCreate() {
  let doc = await SweepState.findOne({ key: 'main' });
  if (!doc) {
    try {
      doc = await SweepState.create({
        key: 'main',
        version: 1,
        state: JSON.stringify({ cfg: seed.cfg || {} }),
      });
    } catch (e) {
      // lost a create race — someone else made it
      doc = await SweepState.findOne({ key: 'main' });
    }
  }
  return doc;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  try {
    await connectToDatabase();
    const doc = await getOrCreate();
    return json({ version: doc.version, state: JSON.parse(doc.state || '{}') });
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}

async function save(req) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }
  const { baseVersion, state } = body || {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return json({ error: 'state object required' }, 400);
  }
  try {
    await connectToDatabase();
    await getOrCreate();
    const updated = await SweepState.findOneAndUpdate(
      { key: 'main', version: Number(baseVersion) || 0 },
      { $set: { state: JSON.stringify(state) }, $inc: { version: 1 } },
      { new: true }
    );
    if (!updated) {
      const cur = await SweepState.findOne({ key: 'main' });
      return json(
        { conflict: true, version: cur.version, state: JSON.parse(cur.state || '{}') },
        409
      );
    }
    return json({ version: updated.version });
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}

export async function PUT(req) {
  return save(req);
}

// sendBeacon (page-unload flush) can only POST.
export async function POST(req) {
  return save(req);
}
