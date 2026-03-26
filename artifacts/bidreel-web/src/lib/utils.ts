import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, differenceInSeconds } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getTimeRemaining(endsAt: string | Date): { 
  text: string; 
  isUrgent: boolean; 
  isEnded: boolean 
} {
  const end = new Date(endsAt);
  const secondsLeft = differenceInSeconds(end, new Date());
  
  if (secondsLeft <= 0) {
    return { text: "Auction Ended", isUrgent: true, isEnded: true };
  }
  
  const isUrgent = secondsLeft < 3600; // Less than 1 hour
  
  if (secondsLeft < 60) return { text: `${secondsLeft}s left`, isUrgent, isEnded: false };
  if (secondsLeft < 3600) return { text: `${Math.floor(secondsLeft / 60)}m left`, isUrgent, isEnded: false };
  if (secondsLeft < 86400) return { text: `${Math.floor(secondsLeft / 3600)}h left`, isUrgent: false, isEnded: false };
  
  return { text: `${Math.floor(secondsLeft / 86400)}d left`, isUrgent: false, isEnded: false };
}
