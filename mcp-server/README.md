# client-portal-mcp

A remote MCP server that gives Claude write access to the client-portal's
Firestore data — so Claude can pull Meta Ads insights (via a separate Meta
Ads MCP connector) and push them straight into the portal.

This is a **separate Vercel project** from the static `index.html` site.
It needs a real server runtime (Next.js API routes) and a build step,
unlike the static site, which stays build-free.

## Tools exposed

- `list_clients` — list all clients with id, name, and Meta Ad Account ID mapping.
- `get_client` — full data for one client (quota + campaigns/ad sets/ads).
- `set_client_meta_account` — map a client to a Meta Ads Ad Account ID (e.g. `act_1234567890`).
- `sync_campaigns` — upsert campaigns/ad sets/ads for a client, merged by name. Never deletes existing data.
- `update_quota` — update a client's post quota counts.

## Local setup

```
cd mcp-server
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

## Deploy to Vercel

1. In Vercel, **Add New... -> Project**, import this same GitHub repo again
   (a second, separate Vercel project pointing at the same repo is fine).
2. Set **Root Directory** to `mcp-server` (this is the key step — without
   it Vercel will try to build the static site as a Next.js app).
3. Framework Preset should auto-detect as **Next.js**.
4. Add the two Environment Variables from `.env.example`
   (`FIREBASE_SERVICE_ACCOUNT`, `MCP_AUTH_TOKEN`) with real values.
5. Deploy. The MCP endpoint will be at
   `https://<your-project>.vercel.app/api/mcp`.

## Getting the Firebase service account key

Firebase console -> Project settings -> Service accounts -> **Generate new
private key**. This downloads a JSON file — base64-encode its full contents
(`base64 -i service-account.json | tr -d '\n'` on macOS/Linux) and paste
that as `FIREBASE_SERVICE_ACCOUNT`. Never commit the raw JSON file.

## Connecting to Claude

In claude.ai -> Settings -> Connectors -> Add custom connector, use:

- URL: `https://<your-project>.vercel.app/api/mcp`
- Auth: Bearer token, value = your `MCP_AUTH_TOKEN`

Once connected, a Claude session with both this connector and a Meta Ads
MCP connector available can pull insights from Meta and push them into the
portal via `sync_campaigns` — this is what a scheduled automation calls.
