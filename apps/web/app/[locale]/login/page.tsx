"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api, setSession } from "@/lib/api";

interface LoginResponse { accessToken?: string; mfaRequired?: boolean; mfaTicket?: string }
interface MePayload { sub: string; roles: string[]; orgCode?: string; partyType?: string }

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const finishLogin = async () => {
    const me = await api<MePayload>("GET", "/auth/me");
    setSession({ roles: me.roles, orgCode: me.orgCode, partyType: me.partyType });
    const target = me.roles.includes("SUPPLIER") ? "supplier" : me.roles.includes("BUYER") ? "buyer" : me.roles.includes("ADMIN") || me.roles.includes("SUPER_ADMIN") ? "admin" : "market";
    router.push(`/${locale}/${target}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api<LoginResponse>("POST", "/auth/login", { email, password });
      if (result.mfaRequired && result.mfaTicket) {
        setMfaTicket(result.mfaTicket);
        return;
      }
      await finishLogin();
    } catch {
      setError(dict.auth.loginFailed);
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("POST", "/auth/mfa/verify", { mfaTicket, code });
      await finishLogin();
    } catch {
      setError(dict.auth.mfaInvalidCode);
    } finally {
      setLoading(false);
    }
  };

  if (mfaTicket) {
    return (
      <div className="mx-auto max-w-sm space-y-6 py-8">
        <h1 className="text-2xl font-semibold">{dict.auth.mfaTitle}</h1>
        <form className="card space-y-4" onSubmit={submitMfa}>
          <p className="text-sm">{dict.auth.mfaPrompt}</p>
          <div>
            <label className="label">{dict.auth.mfaCode}</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
          <button className="btn btn-primary w-full" disabled={loading || code.length !== 6} type="submit">
            {loading ? dict.common.loading : dict.auth.submit}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <h1 className="text-2xl font-semibold">{dict.auth.login}</h1>
      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label">{dict.auth.email}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">{dict.auth.password}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading} type="submit">
          {loading ? dict.common.loading : dict.auth.submit}
        </button>
        <p className="text-right text-sm">
          <Link className="underline" href={`/${locale}/forgot-password`}>
            {dict.auth.forgotPassword}
          </Link>
        </p>
      </form>
    </div>
  );
}
