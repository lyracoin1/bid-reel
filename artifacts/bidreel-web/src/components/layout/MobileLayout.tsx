import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function MobileLayout({ 
  children, 
  showNav = true,
  noPadding = false 
}: { 
  children: ReactNode;
  showNav?: boolean;
  noPadding?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#030305] flex justify-center w-full">
      {/* 
        This wrapper mimics a mobile app shell on desktop. 
        On mobile, it fills the screen. 
      */}
      <div className="relative w-full max-w-md h-[100dvh] bg-background shadow-2xl overflow-hidden flex flex-col border-x border-white/5">
        
        <main className={`flex-1 overflow-y-auto hide-scrollbar ${noPadding ? '' : 'pb-24'}`}>
          {children}
        </main>
        
        {showNav && <BottomNav />}
      </div>
    </div>
  );
}
