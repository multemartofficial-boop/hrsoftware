import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, PoundSterling } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card,
  DataTable,
  EmptyRow,
  Field,
  GhostButton,
  Modal,
  PrimaryButton,
  SectionTitle,
  StatCard,
  StatusBadge,
  Td,
  Th,
  inputCls,
} from "@/components/hr/bits";
import { IncomeVsCostChart } from "@/components/hr/charts";
import { useApi } from "@/lib/api-store";
import { addDays, fmtDate, money, todayISO, MONTHS } from "@/lib/hr-utils";
import type { BuyerIncome, OtherCost } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/finance")({
  head: () => ({
    meta: [
      { title: "Buyer & Profit/Loss — WorkHR" },
      {
        name: "description",
        content: "Track buyer income against worker payroll and other costs, with live profit and loss.",
      },
      { property: "og:title", content: "Buyer & Profit/Loss — WorkHR" },
      {
        property: "og:description",
        content: "Track buyer income against worker payroll and other costs, with live profit and loss.",
      },
    ],
  }),
  component: FinancePage,
});

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

function FinancePage() {
  const {
    buyerIncome,
    otherCosts,
    payrolls,
    addBuyerIncome,
    updateBuyerIncome,
    deleteBuyerIncome,
    addOtherCost,
    updateOtherCost,
    deleteOtherCost,
    loading,
    error,
    loadBuyerIncome,
    loadOtherCosts,
  } = useApi();

  const [from, setFrom] = useState(addDays(todayISO(), -90));
  const [to, setTo] = useState(todayISO());
  const [buyer, setBuyer] = useState("all");

  const [incomeModal, setIncomeModal] = useState<null | { edit?: BuyerIncome }>(null);
  const [costModal, setCostModal] = useState<null | { edit?: OtherCost }>(null);

  const buyers = useMemo(
    () => Array.from(new Set(buyerIncome.map((i) => i.buyer))).sort(),
    [buyerIncome],
  );

  const inRange = (d: string) => d >= from && d <= to;

  const income = useMemo(
    () => buyerIncome.filter((i) => inRange(i.date) && (buyer === "all" || i.buyer === buyer)),
    [buyerIncome, from, to, buyer],
  );
  /* buyer filter narrows income only; costs stay company-wide unless a buyer is picked */
  const costs = useMemo(
    () => (buyer === "all" ? otherCosts.filter((c) => inRange(c.date)) : []),
    [otherCosts, from, to, buyer],
  );
  const pays = useMemo(
    () => (buyer === "all" ? (payrolls || []).filter((p) => inRange(p.created)) : []),
    [payrolls, from, to, buyer],
  );

  const totalIn = (income || []).reduce((t, i) => t + i.amount, 0);
  const totalWorkers = pays.reduce((t, p) => t + p.net, 0);
  const totalCosts = (costs || []).reduce((t, c) => t + c.amount, 0);
  const profit = totalIn - totalWorkers - totalCosts;
  const margin = totalIn > 0 ? (profit / totalIn) * 100 : 0;

  /* monthly comparison across the filtered range */
  const chart = useMemo(() => {
    const map = new Map<string, { income: number; spend: number }>();
    const bump = (iso: string, k: "income" | "spend", v: number) => {
      const key = monthKey(iso);
      const cur = map.get(key) ?? { income: 0, spend: 0 };
      cur[k] += v;
      map.set(key, cur);
    };
    (income || []).forEach((i) => bump(i.date, "income", i.amount));
    pays.forEach((p) => bump(p.created, "spend", p.net));
    (costs || []).forEach((c) => bump(c.date, "spend", c.amount));
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        key,
        label: monthLabel(key),
        income: Math.round(v.income),
        spend: Math.round(v.spend),
        profit: Math.round(v.income - v.spend),
      }));
  }, [income, pays, costs]);

  if (loading.buyerIncome || loading.otherCosts) {
    return (
      <AdminShell title="Buyer & Profit/Loss">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading financial data...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Buyer & Profit/Loss">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load financial data</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => { loadBuyerIncome(); loadOtherCosts(); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  const thisMonth = chart[chart.length - 1];
  const lastMonth = chart[chart.length - 2];
  const change =
    thisMonth && lastMonth && lastMonth.profit !== 0
      ? ((thisMonth.profit - lastMonth.profit) / Math.abs(lastMonth.profit)) * 100
      : null;

  return (
    <AdminShell
      title="Buyer & Profit/Loss"
      action={
        <PrimaryButton className="h-9" onClick={() => setIncomeModal({})}>
          <Plus className="size-4" /> Add Buyer Payment
        </PrimaryButton>
      }
    >
      <div className="space-y-3">
        {/* filters */}
        <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Field label="From" className="sm:w-44">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="To" className="sm:w-44">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Buyer" className="sm:w-56">
            <select value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputCls}>
              <option value="all">All buyers</option>
              {buyers.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          {buyer !== "all" && (
            <p className="text-xs text-muted-foreground sm:pb-3">
              Worker pay and other costs are company-wide — clear the buyer filter to include them.
            </p>
          )}
        </Card>

        {/* stat cards */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="Received from Buyers"
            value={money(totalIn)}
            icon={<PoundSterling className="size-4" />}
            hint={`${income?.length ?? 0} entries`}
          />
          <StatCard
            label="Paid to Workers"
            value={money(totalWorkers)}
            icon={<Wallet className="size-4" />}
            hint={`${pays.length} payslips`}
          />
          <StatCard
            label={profit >= 0 ? "Total Profit" : "Total Loss"}
            value={money(profit)}
            icon={profit >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            delta={profit >= 0 ? "Profit" : "Loss"}
            tone={profit >= 0 ? "up" : "down"}
          />
          <StatCard
            label="Profit Margin"
            value={`${margin.toFixed(1)}%`}
            delta={margin >= 0 ? "Healthy" : "Negative"}
            tone={margin >= 0 ? "up" : "down"}
          />
        </div>

        {/* chart */}
        <Card>
          <SectionTitle title="Received vs Paid Out" />
          {chart.length ? (
            <IncomeVsCostChart data={chart} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No data in this range.</p>
          )}
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">This month</p>
              <p className={cn("text-lg font-semibold", (thisMonth?.profit ?? 0) >= 0 ? "text-success" : "text-danger")}>
                {money(thisMonth?.profit ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Previous month</p>
              <p className="text-lg font-semibold">{money(lastMonth?.profit ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Change</p>
              <p className={cn("text-lg font-semibold", (change ?? 0) >= 0 ? "text-success" : "text-danger")}>
                {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
              </p>
            </div>
          </div>
        </Card>

        {/* buyer income */}
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle
              title="Buyer Income"
              action={
                <GhostButton className="h-9" onClick={() => setIncomeModal({})}>
                  <Plus className="size-4" /> Add Buyer Payment
                </GhostButton>
              }
            />
          </div>
          <DataTable
            labels={["Buyer", "Description", "Amount", "Date", "Status", "Action"]}
            head={
              <>
                <Th>Buyer / Client</Th>
                <Th>Description</Th>
                <Th>Amount</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </>
            }
          >
            {(!income || income.length === 0) && <EmptyRow colSpan={6} text="No buyer payments in this range." />}
            {(income || []).map((i) => (
              <tr key={i.id} className="hover:bg-secondary/40">
                <Td className="font-medium">{i.buyer}</Td>
                <Td className="text-muted-foreground">{i.description}</Td>
                <Td className="font-medium">{money(i.amount)}</Td>
                <Td>{fmtDate(i.date)}</Td>
                <Td>
                  <StatusBadge status={i.status === "Received" ? "Completed" : "Pending"} />
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setIncomeModal({ edit: i })}
                      aria-label={`Edit payment from ${i.buyer}`}
                      className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        deleteBuyerIncome(i.id);
                        toast.success("Buyer payment deleted");
                      }}
                      aria-label={`Delete payment from ${i.buyer}`}
                      className="grid size-8 place-items-center rounded-lg border border-border text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>

        {/* other costs */}
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle
              title="Other Costs"
              action={
                <GhostButton className="h-9" onClick={() => setCostModal({})}>
                  <Plus className="size-4" /> Add Cost
                </GhostButton>
              }
            />
          </div>
          <DataTable
            labels={["Description", "Amount", "Date", "Action"]}
            head={
              <>
                <Th>Description</Th>
                <Th>Amount</Th>
                <Th>Date</Th>
                <Th className="text-right">Action</Th>
              </>
            }
          >
            {(!costs || costs.length === 0) && <EmptyRow colSpan={4} text="No other costs in this range." />}
            {(costs || []).map((c) => (
              <tr key={c.id} className="hover:bg-secondary/40">
                <Td className="font-medium">{c.description}</Td>
                <Td>{money(c.amount)}</Td>
                <Td>{fmtDate(c.date)}</Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setCostModal({ edit: c })}
                      aria-label={`Edit cost ${c.description}`}
                      className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        deleteOtherCost(c.id);
                        toast.success("Cost deleted");
                      }}
                      aria-label={`Delete cost ${c.description}`}
                      className="grid size-8 place-items-center rounded-lg border border-border text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>

        {/* worker payments (read-only) */}
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="Worker Payments (from Payrolls)" />
          </div>
          <DataTable
            labels={["Worker", "Period", "Net Pay", "Status"]}
            head={
              <>
                <Th>Worker</Th>
                <Th>Period</Th>
                <Th>Net Pay</Th>
                <Th>Status</Th>
              </>
            }
          >
            {(!pays || pays.length === 0) && <EmptyRow colSpan={4} text="No payroll runs in this range." />}
            {(pays || []).map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.worker}</Td>
                <Td className="text-muted-foreground">
                  {fmtDate(p.from)} – {fmtDate(p.to)}
                </Td>
                <Td className="font-medium">{money(p.net)}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </div>

      {incomeModal && (
        <IncomeForm
          edit={incomeModal.edit}
          onClose={() => setIncomeModal(null)}
          onSave={(v) => {
            if (incomeModal.edit) {
              updateBuyerIncome(incomeModal.edit.id, v);
              toast.success("Buyer payment updated");
            } else {
              addBuyerIncome(v);
              toast.success(`${money(v.amount)} logged from ${v.buyer}`);
            }
            setIncomeModal(null);
          }}
        />
      )}

      {costModal && (
        <CostForm
          edit={costModal.edit}
          onClose={() => setCostModal(null)}
          onSave={(v) => {
            if (costModal.edit) {
              updateOtherCost(costModal.edit.id, v);
              toast.success("Cost updated");
            } else {
              addOtherCost(v);
              toast.success(`${money(v.amount)} cost added`);
            }
            setCostModal(null);
          }}
        />
      )}
    </AdminShell>
  );
}

function IncomeForm({
  edit,
  onSave,
  onClose,
}: {
  edit?: BuyerIncome | undefined;
  onSave: (v: Omit<BuyerIncome, "id">) => void;
  onClose: () => void;
}) {
  const [buyer, setBuyer] = useState(edit?.buyer ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [amount, setAmount] = useState(String(edit?.amount ?? ""));
  const [date, setDate] = useState(edit?.date ?? todayISO());
  const [status, setStatus] = useState<BuyerIncome["status"]>(edit?.status ?? "Received");
  const valid = buyer.trim() && Number(amount) > 0 && date;

  return (
    <Modal
      title={edit ? "Edit buyer payment" : "Add buyer payment"}
      description="Money received from a buyer or client."
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Buyer / client name" className="sm:col-span-2">
          <input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Description / project" className="sm:col-span-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Amount (£)">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Payment status" className="sm:col-span-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BuyerIncome["status"])}
            className={inputCls}
          >
            <option>Received</option>
            <option>Pending</option>
          </select>
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton
          disabled={!valid}
          onClick={() =>
            onSave({ buyer: buyer.trim(), description: description.trim(), amount: Number(amount), date, status })
          }
        >
          {edit ? "Save changes" : "Add payment"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function CostForm({
  edit,
  onSave,
  onClose,
}: {
  edit?: OtherCost | undefined;
  onSave: (v: Omit<OtherCost, "id">) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(edit?.description ?? "");
  const [amount, setAmount] = useState(String(edit?.amount ?? ""));
  const [date, setDate] = useState(edit?.date ?? todayISO());
  const valid = description.trim() && Number(amount) > 0 && date;

  return (
    <Modal
      title={edit ? "Edit cost" : "Add cost"}
      description="Expenses beyond worker pay — transport, materials, misc."
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" className="sm:col-span-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Amount (£)">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton
          disabled={!valid}
          onClick={() => onSave({ description: description.trim(), amount: Number(amount), date })}
        >
          {edit ? "Save changes" : "Add cost"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
