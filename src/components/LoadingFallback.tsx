import { Loader2 } from 'lucide-react';

export function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-celestial-deep">
      <Loader2 size={32} className="animate-spin text-white/20" />
    </div>
  );
}
