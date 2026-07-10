"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

function ResetPasswordForm({ locale }: { locale: string }) {
  const dict = getDictionary(locale);
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError(dict.auth.passwordTooShort);
    if (password !== confirm) return setError(dict.auth.passwordMismatch);
    setLoading(true);
    try {
      await api("POST", "/auth/reset-password", { token, newPassword: password });
      setDone(true);
    } catch {
      setError(dict.auth.resetFailed);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="card space-y-4 text-sm">
        <p>{dict.auth.resetSuccess}</p>
        <Link className="btn btn-primary w-full" href={`/${locale}/login`}>
          {dict.auth.login}
        </Link>
      </div>
    );
  }

  return (
    <form className="card space-y-4" onSubmit={submit}>
      <div>
        <label className="label">{dict.auth.newPassword}</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div>
        <label className="label">{dict.auth.confirmPassword}</label>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
      <button className="btn btn-primary w-full" disabled={loading || !token} type="submit">
        {loading ? dict.common.loading : dict.auth.resetPassword}
      </button>
    </form>
  );
}

export default function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <h1 className="text-2xl font-semibold">{dict.auth.resetPassword}</h1>
      <Suspense>
        <ResetPasswordForm locale={locale} />
      </Suspense>
    </div>
  );
}
