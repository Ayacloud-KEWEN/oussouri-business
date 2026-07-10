"use client";

import { use, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api, ApiError } from "@/lib/api";

interface MfaStatus { enabled: boolean; internal: boolean }
interface MfaSetup { secret: string; otpauthUrl: string; setupTicket: string }

function MfaSection({ dict }: { dict: ReturnType<typeof getDictionary> }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<MfaStatus>("GET", "/auth/mfa/status").then(setStatus).catch(() => undefined);
  }, []);

  const startSetup = async () => {
    setError(null);
    setMessage(null);
    setSetup(await api<MfaSetup>("POST", "/auth/mfa/setup", {}));
  };

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("POST", "/auth/mfa/enable", { setupTicket: setup!.setupTicket, code });
      setStatus({ enabled: true, internal: status?.internal ?? false });
      setSetup(null);
      setCode("");
      setMessage(dict.auth.mfaEnableSuccess);
    } catch {
      setError(dict.auth.mfaInvalidCode);
    } finally {
      setLoading(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("POST", "/auth/mfa/disable", { password: disablePassword, code });
      setStatus({ enabled: false, internal: status?.internal ?? false });
      setDisabling(false);
      setCode("");
      setDisablePassword("");
      setMessage(dict.auth.mfaDisableSuccess);
    } catch {
      setError(dict.auth.mfaInvalidCode);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  return (
    <div className="card space-y-4">
      <h2 className="font-medium">{dict.auth.mfaTitle}</h2>
      <p className="text-sm">
        {status.enabled ? dict.auth.mfaEnabled : dict.auth.mfaDisabled}
        {status.internal && !status.enabled && <span className="block text-xs opacity-70">{dict.auth.mfaInternalNote}</span>}
      </p>
      {message && <p className="text-sm" style={{ color: "var(--color-primary)" }}>{message}</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}

      {!status.enabled && !setup && (
        <button className="btn btn-outline" onClick={() => void startSetup()}>
          {dict.auth.mfaSetupStart}
        </button>
      )}

      {setup && (
        <form className="space-y-3" onSubmit={enable}>
          <p className="text-sm">{dict.auth.mfaSetupHint}</p>
          <div>
            <label className="label">{dict.auth.mfaSecret}</label>
            <code className="block break-all rounded border p-2 text-sm" style={{ borderColor: "var(--color-border)" }}>{setup.secret}</code>
          </div>
          <div>
            <label className="label">{dict.auth.mfaCode}</label>
            <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <button className="btn btn-primary" disabled={loading || code.length !== 6} type="submit">
            {loading ? dict.common.loading : dict.auth.mfaConfirm}
          </button>
        </form>
      )}

      {status.enabled && !disabling && (
        <button className="btn btn-outline" onClick={() => setDisabling(true)}>
          {dict.auth.mfaDisable}
        </button>
      )}

      {disabling && (
        <form className="space-y-3" onSubmit={disable}>
          <div>
            <label className="label">{dict.auth.password}</label>
            <input className="input" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
          </div>
          <div>
            <label className="label">{dict.auth.mfaCode}</label>
            <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <button className="btn btn-primary" disabled={loading || code.length !== 6} type="submit">
            {loading ? dict.common.loading : dict.auth.mfaDisable}
          </button>
        </form>
      )}
    </div>
  );
}

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
      <MfaSection dict={dict} />
    </div>
  );
}
