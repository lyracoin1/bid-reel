import { useState, useEffect } from "react";

let followedIds = new Set<string>();
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach(l => l());

export function useFollow() {
  const [followed, setFollowed] = useState<Set<string>>(new Set(followedIds));

  useEffect(() => {
    const handler = () => setFollowed(new Set(followedIds));
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const toggle = (sellerId: string) => {
    if (followedIds.has(sellerId)) {
      followedIds.delete(sellerId);
    } else {
      followedIds.add(sellerId);
    }
    notify();
  };

  const isFollowing = (sellerId: string) => followed.has(sellerId);

  return { isFollowing, toggle };
}
