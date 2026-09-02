import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import type { Settings as SettingsType } from "@/lib/mock-data";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Settings — WorkHR" },
      { name: "description", content: "Configure default hourly rates, overtime, tax rates and alert timings." },
      { property: "og:title", content: "Settings — WorkHR" },
      { property: "og:description", content: "Configure default hourly rates, overtime, tax rates and alert timings." },
    ],
  }),
  component: SettingsPage,
});

function NumField({
  label,
  value,
  onChange,
  hint,
  step = "0.1",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls}
      />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </label>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{desc}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function SettingsPage() {
  const { settings, updateSettings, loading } = useApi();
  const [draft, setDraft] = useState<SettingsType | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft(settings);
    }
  }, [settings]);

  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => {
    if (draft) {
      setDraft((d) => ({ ...d, [key]: value }));
    }
    setSaved(false);
  };

  const save = () => {
    if (draft) {
      updateSettings(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  if (loading.settings || !draft) {
    return (
      <AdminShell title="Settings">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading settings...</div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Settings"
      action={
        <button
          onClick={save}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : "Save changes"}
        </button>
      }
    >
      <div className="grid max-w-4xl gap-3">
        <Section title="Pay Defaults" desc="Used by payroll runs whenever a worker has no custom rate.">
          <NumField label="Default hourly rate (£)" value={draft.hourlyRate} onChange={(n) => set("hourlyRate", n)} step="0.5" />
          <NumField
            label="Overtime multiplier"
            value={draft.overtimeMultiplier}
            onChange={(n) => set("overtimeMultiplier", n)}
            hint={`Applied after ${draft.overtimeThreshold} hours per week`}
          />
          <NumField
            label="Overtime threshold (hours/week)"
            value={draft.overtimeThreshold}
            onChange={(n) => set("overtimeThreshold", n)}
            step="1"
          />
          <NumField
            label="Client billing multiplier"
            value={draft.billingMultiplier}
            onChange={(n) => set("billingMultiplier", n)}
            hint="Used in Reports to model client billing"
          />
        </Section>

        <Section title="Tax & Deductions" desc="Applied when calculating net pay on payroll runs.">
          <NumField label="Tax rate (%)" value={draft.taxRate} onChange={(n) => set("taxRate", n)} step="1" />
          <NumField label="National Insurance (%)" value={draft.niRate} onChange={(n) => set("niRate", n)} step="1" />
          <NumField label="Max advance per month (£)" value={draft.maxAdvance} onChange={(n) => set("maxAdvance", n)} step="50" />
        </Section>

        <Section title="Notification Timing" desc="When contract expiry alerts are raised in the Notifications Center.">
          <NumField
            label="First reminder (days before)"
            value={draft.firstReminderDays}
            onChange={(n) => set("firstReminderDays", n)}
            step="1"
          />
          <NumField
            label="Final reminder (days before)"
            value={draft.finalReminderDays}
            onChange={(n) => set("finalReminderDays", n)}
            step="1"
          />
          <NumField
            label="Contract length (months)"
            value={draft.contractMonths}
            onChange={(n) => set("contractMonths", n)}
            step="1"
            hint="Used on approval and reactivation"
          />
        </Section>

        <Section title="Organisation" desc="Basic company details shown on payslips.">
          <TextField label="Company name" value={draft.companyName} onChange={(v) => set("companyName", v)} />
          <TextField label="Payroll contact email" value={draft.payrollEmail} onChange={(v) => set("payrollEmail", v)} />
        </Section>
      </div>
    </AdminShell>
  );
}
