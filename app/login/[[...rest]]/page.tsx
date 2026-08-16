import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { redirect?: string; redirect_url?: string } }) {
  const raw = searchParams.redirect || searchParams.redirect_url;
  const dest = raw && raw.startsWith("/") ? raw : "/dashboard";

  return (
    <div className="container-tight flex min-h-[72vh] flex-col items-center justify-center py-16">
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl={dest} />
      <p className="mt-6 max-w-xs text-center text-xs text-ink/45">
        Sign in with just your email — we’ll send you a code. By continuing you agree to our{" "}
        <a href="/terms" className="text-iris hover:underline">Terms</a> and{" "}
        <a href="/privacy" className="text-iris hover:underline">Privacy Policy</a>.
      </p>
    </div>
  );
}
