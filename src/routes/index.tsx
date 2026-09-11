import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, Mail, Lock, AlertCircle, LogIn } from "lucide-react";
import { inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Log In — WorkHR HR & Payroll" },
      {
        name: "description",
        content:
          "Sign in to WorkHR to manage workers, attendance and payroll, or to check in and out of your shift.",
      },
      { property: "og:title", content: "Log In — WorkHR HR & Payroll" },
      {
        property: "og:description",
        content: "Sign in to WorkHR to manage workers, attendance and payroll.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, workerLogin, clientLogin, session, authReady, loading, error: apiError } = useApi();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loginType, setLoginType] = useState<'email' | 'worker' | 'client'>('email');

  const homeFor = (role?: string) =>
    role === "admin" ? "/admin" : role === "client" ? "/client/dashboard" : "/worker/dashboard";

  useEffect(() => {
    if (authReady && session) {
      void navigate({ to: homeFor(session.role), replace: true });
    }
  }, [authReady, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let s;
    if (loginType === 'email') {
      s = await login(email, password);
    } else if (loginType === 'client') {
      s = await clientLogin(email, password);
    } else {
      s = await workerLogin(email, password); // email field contains worker code
    }

    if (!s) {
      setError(apiError || "Invalid credentials.");
      return;
    }
    setError(null);
    void navigate({ to: homeFor(s.role), replace: true });
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">WorkHR</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in to your HR &amp; Payroll workspace.
          </p>
        </div>

        <form onSubmit={submit} className="card-surface space-y-4 p-6">
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => { setLoginType('email'); setEmail(''); }}
              className={`flex-1 py-2 text-sm rounded-lg ${loginType === 'email' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
            >
              Admin
            </button>
            <button
              type="button"
              onClick={() => { setLoginType('worker'); setEmail(''); }}
              className={`flex-1 py-2 text-sm rounded-lg ${loginType === 'worker' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
            >
              Worker
            </button>
            <button
              type="button"
              onClick={() => { setLoginType('client'); setEmail(''); }}
              className={`flex-1 py-2 text-sm rounded-lg ${loginType === 'client' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
            >
              Client
            </button>
          </div>

          <div>
            <label htmlFor="email" className="text-sm font-medium">
              {loginType === 'worker' ? 'Worker Code' : 'Email'}
            </label>
            <div className="relative mt-1.5">
              <Mail className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                id="email"
                type={loginType === 'worker' ? 'text' : 'email'}
                autoComplete={loginType === 'worker' ? 'off' : 'email'}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={loginType === 'worker' ? 'WKR-2026-XXXX' : loginType === 'client' ? 'you@company.com' : 'you@workhr.com'}
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative mt-1.5">
              <Lock className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
            disabled={loading.login}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading.login ? 'Logging in...' : <><LogIn className="size-4" /> Log In</>}
          </button>

          <div className="mt-4 text-center">
            <Link 
              to="/forgot-password" 
              className="text-sm text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Applying for work?{" "}
          <Link to="/register" className="font-medium text-primary">
            Complete the registration form
          </Link>
        </p>
      </div>
    </div>
  );
}
