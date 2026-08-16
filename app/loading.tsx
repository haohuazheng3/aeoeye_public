import { LogoMark } from "@/components/logo";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <LogoMark className="h-9 w-9 animate-pulse text-iris" />
        <p className="text-sm text-ink/45">Loading…</p>
      </div>
    </div>
  );
}
