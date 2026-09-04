import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Mail, Lock, AlertCircle, CheckCircle } from "lucide-react";
import { inputCls } from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — WorkHR" },
      {
        name: "description",
        content: "Reset your password for WorkHR HR & Payroll system.",
      },
      { property: "og:title", content: "Forgot Password — WorkHR" },
      {
        property: "og:description", content: "Reset your password for WorkHR HR & Payroll system.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await apiClient.post('/api/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="card-surface p-6 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-green-100 text-green-600">
              <CheckCircle className="size-6" />
            </div>
            <h1 className="text-xl font-bold mb-2">Reset Link Sent</h1>
            <p className="text-sm text-muted-foreground mb-6">
              If the email address you provided is associated with an account, you will receive a password reset link shortly.
            </p>
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ArrowLeft className="size-4" /> Back to login
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
          <h1 className="text-2xl font-bold tracking-tight">Forgot Password</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Reset your password for WorkHR
          </p>
        </div>

        <form onSubmit={submit} className="card-surface space-y-4 p-6">
          <div>
            <label htmlFor="email" className="text-sm font-medium">
              Email Address
            </label>
            <div className="relative mt-1.5">
              <Mail className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className={`${inputCls} pl-9`}
              />
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
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
}