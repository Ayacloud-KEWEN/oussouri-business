"use client";

import { use, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api, ApiError } from "@/lib/api";

export default function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (password.length < 10) return setError(dict.auth.passwordTooShort);
    if (password !== confirm) return setError(dict.auth.passwordMismatch);
    setLoading(true);
    try {
      // 旧会话已全部吊销，API 同步下发新 cookie 续登录态
      await api("POST", "/auth/change-password", { oldPassword, newPassword: password });
      setSuccess(true);
      setOldPassword("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? dict.auth.changeFailedOld : dict.common.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <h1 className="text-2xl font-semibold">{dict.auth.accountSettings}</h1>
      <form className="card space-y-4" onSubmit={submit}>
        <h2 className="font-medium">{dict.auth.changePassword}</h2>
        <div>
          <label className="label">{dict.auth.oldPassword}</label>
          <input className="input" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">{dict.auth.newPassword}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">{dict.auth.confirmPassword}</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
        {success && <p className="text-sm" style={{ color: "var(--color-primary)" }}>{dict.auth.changeSuccess}</p>}
        <button className="btn btn-primary w-full" disabled={loading} type="submit">
          {loading ? dict.common.loading : dict.auth.submit}
        </button>
      </form>
    </div>
  );
}
