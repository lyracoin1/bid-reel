import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";

export default function NotFound() {
  return (
    <MobileLayout showNav={true}>
      <div className="flex flex-col justify-center items-center h-[80vh] px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-6">
          <AlertCircle size={40} />
        </div>
        <h1 className="text-3xl font-display font-bold mb-4">404</h1>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/" className="px-8 py-4 bg-secondary rounded-full font-bold hover:bg-secondary/80 transition">
          Go Home
        </Link>
      </div>
    </MobileLayout>
  );
}
