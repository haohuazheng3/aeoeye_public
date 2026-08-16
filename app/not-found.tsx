import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container-tight flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center surface text-iris">
        <Compass className="h-7 w-7" />
      </div>
      <p className="mt-5 font-display text-6xl font-semibold text-iris">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">This page wandered off</h1>
      <p className="mt-2 max-w-md text-ink/60">The page you’re looking for doesn’t exist or moved.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="btn-primary">
          Back home
        </Link>
        <Link href="/#audit" className="btn-ghost">
          Run a free audit
        </Link>
      </div>
    </div>
  );
}
