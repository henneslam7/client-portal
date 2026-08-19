import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { getDb, COLLECTION } from '../../../lib/firebaseAdmin';
import { mergeCampaigns } from '../../../lib/sync';

const OBJECTIVES = ['Awareness', 'Traffic', 'Engagement', 'Leads', 'Sales', 'AppPromotion'] as const;

const targetingSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  location: z.string().optional(),
  placement: z.string().optional(),
  interests: z.string().optional(),
});

const adSchema = z.object({
  name: z.string(),
  spendHKD: z.number().optional(),
  reach: z.number().optional(),
  clicks: z.number().optional(),
  results: z.number().optional(),
  notes: z.string().optional(),
});

const adsetSchema = z.object({
  name: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budgetHKD: z.number().optional(),
  targeting: targetingSchema.optional(),
  ads: z.array(adSchema).optional(),
});

const campaignSchema = z.object({
  name: z.string(),
  objective: z.enum(OBJECTIVES).optional(),
  notes: z.string().optional(),
  adsets: z.array(adsetSchema).optional(),
});

async function loadClientDoc(clientId: string) {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc('client:' + clientId);
  const snap = await ref.get();
  return { ref, exists: snap.exists, data: snap.exists ? (snap.data() as any).value : null };
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    'list_clients',
    {
      title: 'List clients',
      description:
        "List all client-portal clients with their id, name, and Meta Ad Account ID mapping (if set). Use this first to find a client's id before calling other tools.",
      inputSchema: z.object({}),
    },
    async () => {
      const db = getDb();
      const idxSnap = await db.collection(COLLECTION).doc('clients-index').get();
      const index: Array<{ id: string; name: string }> = idxSnap.exists ? (idxSnap.data() as any).value || [] : [];
      const clients = await Promise.all(
        index.map(async (c) => {
          const { data } = await loadClientDoc(c.id);
          return { id: c.id, name: c.name, metaAdAccountId: data?.metaAdAccountId || '' };
        })
      );
      return { content: [{ type: 'text', text: JSON.stringify(clients, null, 2) }] };
    }
  );

  server.registerTool(
    'get_client',
    {
      title: 'Get client',
      description: "Get a client's full portal data: quota, and its campaigns/ad sets/ads.",
      inputSchema: z.object({ clientId: z.string() }),
    },
    async ({ clientId }) => {
      const { exists, data } = await loadClientDoc(clientId);
      if (!exists) return { content: [{ type: 'text', text: '找唔到呢個client。' }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'set_client_meta_account',
    {
      title: 'Set client Meta Ad Account ID',
      description:
        'Map a portal client to a Meta Ads Ad Account ID (e.g. act_1234567890), so automated syncs know which ad account belongs to which client.',
      inputSchema: z.object({ clientId: z.string(), metaAdAccountId: z.string() }),
    },
    async ({ clientId, metaAdAccountId }) => {
      const { ref, exists, data } = await loadClientDoc(clientId);
      if (!exists) return { content: [{ type: 'text', text: '找唔到呢個client。' }], isError: true };
      data.metaAdAccountId = metaAdAccountId;
      await ref.set({ value: data });
      return { content: [{ type: 'text', text: `已將「${data.name}」對應到 ${metaAdAccountId}` }] };
    }
  );

  server.registerTool(
    'sync_campaigns',
    {
      title: 'Sync campaigns into a client',
      description:
        'Upsert campaigns/ad sets/ads for a client, merged by name (case-insensitive, trimmed). Entries matched by name get their dates/budget/targeting/spend/reach/clicks/results updated in place; unmatched names are created as new campaigns/ad sets/ads. Never deletes existing data. Use this to push Meta Ads data (pulled via the Meta Ads MCP) into the portal — map objective to one of Awareness/Traffic/Engagement/Leads/Sales/AppPromotion, and set "results" to whatever the objective\'s primary metric is (leads, conversions, engagements, installs, link clicks...); leave results unset for Awareness campaigns since the portal derives CPM from reach directly.',
      inputSchema: z.object({ clientId: z.string(), campaigns: z.array(campaignSchema) }),
    },
    async ({ clientId, campaigns }) => {
      const { ref, exists, data } = await loadClientDoc(clientId);
      if (!exists) {
        return { content: [{ type: 'text', text: '找唔到呢個client，請先用list_clients確認clientId。' }], isError: true };
      }
      data.campaigns = mergeCampaigns(data.campaigns || [], campaigns);
      await ref.set({ value: data });
      return {
        content: [
          { type: 'text', text: `已更新「${data.name}」，而家有 ${data.campaigns.length} 個行銷活動。` },
        ],
      };
    }
  );

  server.registerTool(
    'update_quota',
    {
      title: 'Update post quota',
      description: "Update a client's post quota (signed/used counts) for static, carousel, or reels post types.",
      inputSchema: z.object({
        clientId: z.string(),
        type: z.enum(['static', 'carousel', 'reels']),
        signed: z.number().optional(),
        used: z.number().optional(),
      }),
    },
    async ({ clientId, type, signed, used }) => {
      const { ref, exists, data } = await loadClientDoc(clientId);
      if (!exists) return { content: [{ type: 'text', text: '找唔到呢個client。' }], isError: true };
      data.quota = data.quota || {};
      data.quota[type] = data.quota[type] || { signed: 0, used: 0 };
      if (signed !== undefined) data.quota[type].signed = signed;
      if (used !== undefined) data.quota[type].used = used;
      await ref.set({ value: data });
      return { content: [{ type: 'text', text: `已更新「${data.name}」嘅${type}名額。` }] };
    }
  );
}, {});

const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  if (!process.env.MCP_AUTH_TOKEN || bearerToken !== process.env.MCP_AUTH_TOKEN) return undefined;
  return { token: bearerToken, scopes: ['portal'], clientId: 'client-portal-admin' };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ['portal'],
});

export { authHandler as GET, authHandler as POST };
