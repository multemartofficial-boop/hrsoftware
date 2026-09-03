import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Lock, AlertCircle, CheckCircle, Eye, EyeOff } from "lucide-react";
import { inputCls } from "@/components/hr/bits";
import apiClient from "@/lib/api-client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — WorkHR" },
      {
        name: "description",
        content: "Reset your password for WorkHR HR & Payroll system.",
      },
      { property: "og:title", content: "Reset Password — WorkHR" },
      {
        property: "og:description", content: "Reset your password for WorkHR HR & Payroll system.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/reset-password" });
  const token = search.token as string;

  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState<'admin' | 'worker'>('admin');
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError("No reset token provided. Please use the link sent to your email.");
      setValidating(false);
      return;
    }

    // Validate token
    apiClient.get(`/api/auth/validate-reset-token/${token}`)
      .then((response) => {
        setTokenValid(true);
        setEmail(response.email);
        setUserType(response.userType);
        setValidating(false);
      })
      .catch((err) => {
        setTokenError(err.response?.data?.error || "Invalid or expired reset link");
        setTokenValid(false);
        setValidating(false);
      });
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await apiClient.post('/api/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="card-surface p-6 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-secondary">
              <Lock className="size-6 text-muted-foreground animate-pulse" />
            </div>
            <h1 className="text-xl font-bold mb-2">Validating Reset Link...</h1>
            <p className="text-sm text-muted-foreground">Please wait while we verify your reset link.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="card-surface p-6 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-100 text-red-600">
              <AlertCircle className="size-6" />
            </div>
            <h1 className="text-xl font-bold mb-2">Invalid Reset Link</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {tokenError || "This reset link is invalid or has expired."}
            </p>
            <div className="flex flex-col gap-3">
              <Link 
                to="/forgot-password" 
                className="inline-flex items-center justify-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                Request new reset link
              </Link>
              <Link 
                to="/" 
                className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> Back to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="card-surface p-6 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-green-100 text-green-600">
              <CheckCircle className="size-6" />
            </div>
            <h1 className="text-xl font-bold mb-2">Password Reset Successfully</h1>
            <p className="text-sm text-muted-foreground mb-2">
              Your password has been reset successfully.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              You can now log in with your new password.
            </p>
            <Link 
              to="/" 
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="size-4" /> Back to login
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Reset Your Password</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Enter a new password for {email}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Account Type: {userType === 'admin' ? 'Admin' : 'Worker'}
          </p>
        </div>

        <form onSubmit={submit} className="card-surface space-y-4 p-6">
          <div>
            <label htmlFor="password" className="text-sm font-medium">
              New Password
            </label>
            <div className="relative mt-1.5">
              <Lock className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputCls} pl-9 pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm New Password
            </label>
            <div className="relative mt-1.5">
              <Lock className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputCls} pl-9 pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <AlertCircle className="size-4 shrink-0" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Resetting Password...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}