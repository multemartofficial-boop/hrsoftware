import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Plus, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { fmtDate, money } from "@/lib/hr-utils";
import type { Settings as SettingsType, BankHoliday } from "@/lib/mock-data";

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
  const [holidays, setHolidays] = useState<BankHoliday[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [holidayError, setHolidayError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    apiClient
      .get<BankHoliday[]>("/api/settings/bank-holidays")
      .then(setHolidays)
      .catch(() => setHolidayError("Could not load bank holidays"));
  }, []);

  const addHoliday = async () => {
    if (!newHolidayDate) return;
    setHolidayError(null);
    try {
      const list = await apiClient.post<BankHoliday[]>("/api/settings/bank-holidays", {
        date: newHolidayDate,
        name: newHolidayName || "Bank Holiday",
      });
      setHolidays(list);
      setNewHolidayDate("");
      setNewHolidayName("");
    } catch (err) {
      setHolidayError(err instanceof Error ? err.message : "Failed to add bank holiday");
    }
  };

  const removeHoliday = async (id: number) => {
    setHolidayError(null);
    try {
      await apiClient.delete(`/api/settings/bank-holidays/${id}`);
      setHolidays((h) => h.filter((x) => x.id !== id));
    } catch (err) {
      setHolidayError(err instanceof Error ? err.message : "Failed to remove bank holiday");
    }
  };

  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => {
    if (draft) {
      setDraft({ ...draft, [key]: value });
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
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <div className="space-y-3">
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
        </Section>

        <Section title="Bank Holiday Pay" desc="Extra pay for hours worked on UK bank holidays. Applied to payroll and summary views.">
          <NumField
            label="Holiday pay multiplier"
            value={draft.holidayPayMultiplier}
            onChange={(n) => set("holidayPayMultiplier", n)}
            hint={`e.g. 2.0 = double time (${money(draft.hourlyRate * draft.holidayPayMultiplier)}/h at default rate)`}
          />
          <NumField
            label="Holiday Accrual Rate (%)"
            value={draft.holidayAccrualRate}
            onChange={(n) => set("holidayAccrualRate", n)}
            step="0.01"
            hint="UK statutory 12.07% (5.6 ÷ 46.4 weeks). Accrued on every hour worked; stored per entry at check-out."
          />
          <div className="sm:col-span-2">
            <span className="text-sm font-medium">UK bank holiday dates</span>
            <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
              Attendance on these dates is paid at the holiday multiplier. Update annually.
            </p>
            <div className="space-y-1.5">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                  <span className="font-medium">{fmtDate(h.date)}</span>
                  <span className="flex-1 text-muted-foreground">{h.name}</span>
                  <button
                    type="button"
                    onClick={() => removeHoliday(h.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-danger"
                    title="Remove"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {holidays.length === 0 && (
                <p className="text-xs text-muted-foreground">No bank holidays configured.</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={newHolidayDate}
                onChange={(e) => setNewHolidayDate(e.target.value)}
                className={`${inputCls} w-40`}
              />
              <input
                type="text"
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
                placeholder="Name (optional)"
                className={`${inputCls} flex-1 min-w-32`}
              />
              <button
                type="button"
                onClick={addHoliday}
                className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-secondary"
              >
                <Plus className="size-4" /> Add
              </button>
            </div>
            {holidayError && <p className="mt-1 text-xs text-danger">{holidayError}</p>}
          </div>
        </Section>
        </div>

        <div className="space-y-3">
        <Section title="Tax & Deductions" desc="Applied when calculating net pay on payroll runs.">
          <NumField label="Tax rate (%)" value={draft.taxRate} onChange={(n) => set("taxRate", n)} step="1" />
          <NumField label="National Insurance (%)" value={draft.niRate} onChange={(n) => set("niRate", n)} step="1" />
          <NumField label="Max advance per month (£)" value={draft.maxAdvance} onChange={(n) => set("maxAdvance", n)} step="50" />
        </Section>

        <Section title="Company" desc="Details used on generated documents and emails.">
          <div className="sm:col-span-2">
            <span className="text-sm font-medium">Authorised signatory</span>
            <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
              Shown under "Signed by Company" when a template or document is signed — e.g. Abdullah Mohammad Abubakar.
            </p>
            <input
              type="text"
              value={draft.companySignatory ?? ""}
              onChange={(e) => set("companySignatory", e.target.value)}
              placeholder="Name of the person who signs for the company"
              className={inputCls}
            />
          </div>
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
        </div>
      </div>
    </AdminShell>
  );
}
