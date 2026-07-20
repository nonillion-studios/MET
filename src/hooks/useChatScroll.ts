import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared "stick to bottom on new message, otherwise show a jump-to-end
 * button" behavior for TeamChatThread and DirectThread — previously
 * duplicated near-verbatim in both. Scrolling only happens when the user was
 * already near the bottom (nearBottomRef), so an incoming message never
 * yanks the view away from wherever the user has scrolled to read history.
 *
 * Scrolls by setting `scrollRef`'s own `scrollTop` directly, never via
 * `bottomRef.current.scrollIntoView(...)`. `scrollIntoView` walks and scrolls
 * *every* scrollable ancestor needed to bring the target into view, not just
 * the chat's own message list — if the chat panel sits inside any other
 * scrollable ancestor (the page body, a dock region, a modal), each new
 * message also dragged that ancestor's scroll position along with it, which
 * is what "the whole UI jumps" on every message actually was. Setting
 * `scrollTop` touches only this one element.
 */
export function useChatScroll(messageCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    else setShowJumpToEnd(true);
  }, [messageCount]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = near;
    if (near) setShowJumpToEnd(false);
  };

  const jumpToEnd = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    nearBottomRef.current = true;
    setShowJumpToEnd(false);
  };

  /** Call before an optimistic send so the thread stays pinned to the bottom for the sender's own message. */
  const pinToBottom = () => { nearBottomRef.current = true; };

  return { scrollRef, showJumpToEnd, handleScroll, jumpToEnd, pinToBottom };
}
