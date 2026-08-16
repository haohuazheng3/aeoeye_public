import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SignUpPage({ searchParams }: { searchParams: { redirect?: string; redirect_url?: string } }) {
  const raw = searchParams.redirect || searchParams.redirect_url;
  const dest = raw && raw.startsWith("/") ? raw : "/dashboard";

  return (
    <div className="container-tight flex min-h-[72vh] flex-col items-center justify-center py-16">
      <SignUp signInUrl="/login" fallbackRedirectUrl={dest} />
      <p className="mt-6 max-w-xs text-center text-xs text-ink/45">
        Just your email — no password needed. By continuing you agree to our{" "}
        <a href="/terms" className="text-iris hover:underline">Terms</a> and{" "}
        <a href="/privacy" className="text-iris hover:underline">Privacy Policy</a>.
      </p>
    </div>
  );
}
