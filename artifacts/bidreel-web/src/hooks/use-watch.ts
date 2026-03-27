import { useState, useEffect } from "react";

let watchedIds = new Set<string>();
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach(l => l());

/**
 * Track which upcoming auctions the user has set a reminder for.
 * This is in-memory mock state — ready to be wired to a push-notification
 * backend in the future.
 */
export function useWatchAuction() {
  const [watched, setWatched] = useState<Set<string>>(new Set(watchedIds));

  useEffect(() => {
    const handler = () => setWatched(new Set(watchedIds));
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const toggle = (auctionId: string) => {
    if (watchedIds.has(auctionId)) {
      watchedIds.delete(auctionId);
    } else {
      watchedIds.add(auctionId);
    }
    notify();
  };

  const isWatching = (auctionId: string) => watched.has(auctionId);

  return { isWatching, toggle };
}
