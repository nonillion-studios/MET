import type { Page } from '@playwright/test';

/**
 * Mocks just enough of Supabase (REST + auth/user) to reach a team's Chat tab
 * without a live backend — mirrors studioFixture.ts's localStorage session
 * seeding, extended with `page.route` interception since Teams data (unlike
 * Studio's IndexedDB-only state) is fetched over the network.
 *
 * Realtime (the websocket) is deliberately left unmocked: nothing here needs
 * an *incoming* message from another client to reproduce or verify the
 * scroll-jump bug — sending your own message already exercises the exact
 * same "new message appended -> scroll effect fires" path via the optimistic
 * append in TeamChatThread's handleSend, so leaving the socket to fail its
 * connection quietly in the background is fine.
 */

export const USER_ID = '00000000-0000-0000-0000-000000000001';
export const TEAM_ID = 'e2e0aaaa-0000-0000-0000-000000000001';
const USER_EMAIL = 'e2e@test.local';

async function seedSession(page: Page): Promise<void> {
  await page.evaluate(({ userId, email }) => {
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: 'e2e-fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: oneHourFromNow,
      refresh_token: 'e2e-fake-refresh-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        app_metadata: {},
        user_metadata: { name: 'E2E Owner', avatar: '' },
        created_at: new Date().toISOString(),
      },
    }));
  }, { userId: USER_ID, email: USER_EMAIL });
}

/** Builds `count` seeded messages so the thread starts tall enough to actually scroll. */
function seedMessages(count: number) {
  const base = Date.now() - count * 60_000;
  return Array.from({ length: count }, (_, i) => ({
    id: `e2e-msg-${i}`,
    team_id: TEAM_ID,
    sender_id: USER_ID,
    body: `Seeded message #${i + 1} — enough text to take up a real line of the thread.`,
    created_at: new Date(base + i * 60_000).toISOString(),
    reply_to_id: null,
    edited_at: null,
    deleted: false,
    pinned: false,
    attachment_msg_id: null,
    attachment_name: null,
    attachment_size: null,
    sender: { name: 'E2E Owner', avatar: '' },
  }));
}

async function mockSupabase(page: Page, opts: { seededMessageCount: number }): Promise<void> {
  const messages = seedMessages(opts.seededMessageCount);
  // Grows by one extra message on every subsequent GET — lets a test trigger a
  // "the message list grew" re-render (via reload(), e.g. by changing the
  // search box) without needing a real realtime event.
  let listCallCount = 0;

  await page.route('**/auth/v1/user*', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID, aud: 'authenticated', role: 'authenticated', email: USER_EMAIL,
        app_metadata: {}, user_metadata: { name: 'E2E Owner', avatar: '' }, created_at: new Date().toISOString(),
      }),
    });
  });

  await page.route('**/rest/v1/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split('/').pop() || '';
    const method = req.method();
    // supabase-js's `.single()`/`.maybeSingle()` set this Accept header and expect a bare
    // object back (real PostgREST unwraps server-side) — respond in kind, or `data` silently
    // comes back shaped wrong and callers relying on it (e.g. isAdmin from syncProfile) never
    // resolve true, or a stray `.throwOnError()`-free rejection leaves a `loading` state stuck
    // forever. `fulfillAs` below picks the right shape once per table instead of per call site.
    const wantsSingle = (req.headers()['accept'] || '').includes('vnd.pgrst.object+json');
    const fulfillAs = (rows: unknown[]) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(wantsSingle ? (rows[0] ?? null) : rows),
    });

    if (table === 'profiles' && method === 'POST') {
      return fulfillAs([{ is_admin: true }]);
    }
    if (table === 'teams' && method === 'GET') {
      return fulfillAs([{
        id: TEAM_ID, name: 'E2E Team', logo: '', owner_id: USER_ID, telegram_channel_id: '',
        description: '', visibility: 'private', pay_note: '', join_ad_url: null, tags: [], created_at: new Date().toISOString(),
      }]);
    }
    if (table === 'team_members' && method === 'GET') {
      return fulfillAs([]);
    }
    if (table === 'team_messages' && method === 'GET') {
      listCallCount += 1;
      const extra = Array.from({ length: listCallCount - 1 }, (_, i) => ({
        ...messages[0],
        id: `e2e-extra-msg-${i}`,
        body: `Reload-triggered message #${i + 1}`,
        created_at: new Date(Date.now() + (i + 1) * 1000).toISOString(),
      }));
      return fulfillAs([...messages, ...extra]);
    }
    if (table === 'team_messages' && method === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    if (table === 'message_reactions' && method === 'GET') {
      return fulfillAs([]);
    }
    // Everything else (leaderboard, wallet, badges, notifications, ...) isn't needed to reach
    // Chat — an empty array/null keeps those sections quietly idle instead of console-erroring.
    return fulfillAs([]);
  });
}

/** Loads the app already "signed in" as the owner of a team with `seededMessageCount` chat messages, and opens Teams > Chat. */
export async function openTeamChat(page: Page, opts: { seededMessageCount?: number } = {}): Promise<void> {
  await page.goto('/');
  await seedSession(page);
  await mockSupabase(page, { seededMessageCount: opts.seededMessageCount ?? 40 });
  await page.reload();

  await page.getByRole('button', { name: 'Teams', exact: true }).first().click();
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await page.locator('input[placeholder="Message the team..."]').waitFor({ state: 'visible', timeout: 20_000 });
}
