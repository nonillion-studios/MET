import { test, expect } from '@playwright/test';
import { openTeamChat } from './teamsFixture';

/**
 * Reproduces and pins the "chat UI always goes up when a message arrives" bug.
 *
 * Root cause: `useChatScroll`'s scroll-to-bottom effect called
 * `bottomRef.current.scrollIntoView({ block: 'end' })`. `scrollIntoView` scrolls
 * *every* scrollable ancestor needed to bring the target into view, not just the
 * chat's own message list — and this app's root layout (`min-h-screen` in
 * App.tsx, no inner overflow wrapper around the main content) means the actual
 * page/window scrolls. So every new message dragged `window.scrollY` along with
 * it, on top of the chat's own internal scroll — "the whole UI goes up".
 *
 * The fix scrolls only the chat's own container via `el.scrollTop`, which can
 * never touch an ancestor's scroll position. This test sends a message (the
 * optimistic-append path added alongside this fix exercises the exact same
 * "message count changed -> scroll effect fires" code as a real incoming
 * message would) and asserts the page's own scroll position is untouched.
 */
test('sending a chat message scrolls only the thread, not the page', async ({ page }) => {
  // A short viewport guarantees the outer page is actually scrollable regardless
  // of how tall TeamsPanel's own chrome happens to be — the point under test is
  // "does the page scroll AT ALL", so it must be possible for it to.
  await page.setViewportSize({ width: 1280, height: 400 });
  await openTeamChat(page, { seededMessageCount: 60 });

  const thread = page.getByTestId('chat-scroll');

  // Scroll the outer page down first, so a regression that drags window scroll
  // along with the chat would show up as a *change*, not just "already at 0".
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const pageScrollBefore = await page.evaluate(() => window.scrollY);

  const threadScrollableBefore = await thread.evaluate(el => el.scrollHeight > el.clientHeight);
  expect(threadScrollableBefore).toBe(true);

  const input = page.locator('input[placeholder="Message the team..."]');
  await input.fill('Hello from Playwright');
  await input.press('Enter');

  // The optimistic message should render immediately.
  await expect(page.getByText('Hello from Playwright')).toBeVisible();

  // The thread itself should have scrolled to its own bottom...
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);

  // ...but the outer page must not have moved at all.
  const pageScrollAfter = await page.evaluate(() => window.scrollY);
  expect(pageScrollAfter).toBe(pageScrollBefore);
});

test('message list growing while scrolled away neither jumps the thread nor moves the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openTeamChat(page, { seededMessageCount: 60 });

  const thread = page.getByTestId('chat-scroll');

  // Scroll the thread itself away from the bottom — simulates a user reading
  // history when a new message arrives (nearBottomRef becomes false).
  await thread.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBeLessThan(5);

  await page.evaluate(() => window.scrollTo(0, 300));
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  const threadScrollBefore = await thread.evaluate(el => el.scrollTop);

  // Typing into the search box re-runs the message-list effect (reload()),
  // and the fixture's mock returns one extra message on every subsequent
  // call — so this changes messages.length exactly the way a genuine
  // incoming message would, without needing a real realtime event.
  await page.locator('input[placeholder="Search messages..."]').fill('Seeded');
  await expect(page.getByText('Reload-triggered message #1')).toBeAttached();

  // Not near the bottom, so the thread must NOT auto-scroll...
  const threadScrollAfter = await thread.evaluate(el => el.scrollTop);
  expect(threadScrollAfter).toBe(threadScrollBefore);

  // ...and the page must never have moved either way.
  const pageScrollAfter = await page.evaluate(() => window.scrollY);
  expect(pageScrollAfter).toBe(pageScrollBefore);

  // A "jump to end" affordance should appear since we're not pinned to bottom.
  await expect(page.getByText('New messages')).toBeVisible();
});
