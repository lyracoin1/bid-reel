import { useState, useEffect } from "react";

let savedIds = new Set<string>();
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export function useSaveAuction() {
  const [saved, setSaved] = useState<Set<string>>(new Set(savedIds));

  useEffect(() => {
    const handler = () => setSaved(new Set(savedIds));
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const toggle = (auctionId: string) => {
    if (savedIds.has(auctionId)) {
      savedIds.delete(auctionId);
    } else {
      savedIds.add(auctionId);
    }
    notify();
  };

  const isSaved = (auctionId: string) => saved.has(auctionId);

  return { isSaved, toggle };
}
