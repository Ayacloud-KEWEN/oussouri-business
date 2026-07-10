"use client";

import { use, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

export default function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api("POST", "/auth/forgot-password", { email });
    } finally {
      // 无论邮箱是否存在都提示已发送（防枚举，与后端一致）
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <h1 className="text-2xl font-semibold">{dict.auth.resetPassword}</h1>
      {sent ? (
        <p className="card text-sm">{dict.auth.resetLinkSent}</p>
      ) : (
        <form className="card space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">{dict.auth.forgotPasswordHint}</p>
          <div>
            <label className="label">{dict.auth.email}</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button className="btn btn-primary w-full" disabled={loading} type="submit">
            {loading ? dict.common.loading : dict.auth.sendResetLink}
          </button>
        </form>
      )}
    </div>
  );
}
