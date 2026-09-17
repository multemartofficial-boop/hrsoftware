import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  MessageCircle,
  LifeBuoy,
  Search,
  ChevronDown,
  LayoutDashboard,
  CalendarCheck,
  Wallet,
  Users,
  UserCheck,
  MapPin,
  MapPinned,
  Building2,
  FileText,
  Scale,
  BarChart3,
  TriangleAlert,
  History,
  Bell,
  Settings,
  Smartphone,
  Clock,
  FileSignature,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card } from "@/components/hr/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/help")({
  head: () => ({
    meta: [
      { title: "Help & Center — WorkHR" },
      { name: "description", content: "Complete A–Z guide to every WorkHR feature across the Admin and Worker panels." },
      { property: "og:title", content: "Help & Center — WorkHR" },
      { property: "og:description", content: "Complete A–Z guide to every WorkHR feature across the Admin and Worker panels." },
    ],
  }),
  component: HelpPage,
});

/* ------------------------------------------------------------------ */
/*  Course content — every feature, per panel                          */
/* ------------------------------------------------------------------ */

type Topic = {
  icon: typeof Users;
  title: string;
  where: string;
  what: string;
  steps: string[];
  notes?: string[];
};

const ADMIN_TOPICS: Topic[] = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    where: "Sidebar → Dashboard",
    what: "Your at-a-glance overview: worker counts, attendance activity, pending approvals and recent notifications, all loaded live from the database.",
    steps: [
      "Log in on the Admin tab with your email and password.",
      "The dashboard loads automatically after login.",
      "Use the stat cards to jump into the busiest areas (workers, approvals, payroll).",
    ],
  },
  {
    icon: CalendarCheck,
    title: "Attendance",
    where: "Sidebar → Attendance",
    what: "Every check-in/check-out from all workers. Self check-ins arrive with GPS verification; you can also add or edit records manually.",
    steps: [
      "Open Attendance to see all records, newest first.",
      "Click Add Attendance to create a manual entry (worker, date, times, location). Hours and statutory holiday accrual are calculated automatically.",
      "Edit a record to correct times — the change is written to Action History.",
      "Watch for 'Location Mismatch' (GPS outside every geofence) and 'Assignment Mismatch' (checked in at a different site than assigned) flags in red.",
    ],
    notes: [
      "Holiday accrual (default 12.07%) is stored on each record at checkout time, so later rate changes never rewrite history.",
      "A worker with an expired visa is blocked from checking in automatically.",
    ],
  },
  {
    icon: Wallet,
    title: "Payrolls",
    where: "Sidebar → Payrolls",
    what: "Generate pay runs from real attendance. Rates, overtime multiplier/threshold, tax and NI come from Settings; UK bank holiday pay and statutory holiday accrual are included.",
    steps: [
      "Click Generate Payroll and pick the worker(s) and pay period.",
      "The system sums attendance hours in the period, applies the hourly rate, overtime above the threshold, bank-holiday uplift and holiday accrual pay.",
      "Review gross → deductions (tax, NI, advances) → net pay, then confirm.",
      "Mark a run Completed once paid; each generation is logged in Action History.",
    ],
    notes: ["A payroll run stores the numbers as-at generation time — changing Settings later does not alter existing payrolls."],
  },
  {
    icon: Users,
    title: "Worker Directory & Worker Details",
    where: "Sidebar → Worker Directory",
    what: "All active/expired workers. Each worker has a full profile page: unique worker code, contact info, N.I. number, passport/visa/SIA details, registration documents, BS7858 compliance checklist, plus their attendance and payroll history.",
    steps: [
      "Click any worker row to open Worker Details.",
      "Copy the Worker Code — the worker uses it to log in to the Worker Portal.",
      "Registration documents (photo, proof of address, eVisa, passport, SIA badge, share codes) are viewable in the secure viewer if the worker came through the registration form.",
      "Tick off the 8 BS7858 compliance checks with status, notes and completion date, then Save checklist.",
      "Use Reactivate contract when a worker is expiring/expired, or Remove worker to delete them (this also removes their login).",
    ],
    notes: ["Deleting a worker frees their email for future re-registration."],
  },
  {
    icon: UserCheck,
    title: "Registration Approvals",
    where: "Sidebar → Registration Approvals",
    what: "Public applications from the 5-step registration form land here as Pending. Review the full bio-data, view uploaded documents securely, complete the compliance checklist, then approve or reject.",
    steps: [
      "Click a pending application to open the full detail view.",
      "Check every section: personal details, addresses, eligibility, work history, referees, skills.",
      "Click any document tile to view it in the secure viewer (images and PDFs).",
      "Approve → a worker record and worker code are created and a password-setup email is sent automatically.",
      "Reject → the application moves to the Rejected tab with the date recorded.",
      "Use Resend setup link if the worker never received or lost their email.",
    ],
    notes: [
      "Uploads are capped at 3 MB per file (JPG/PNG/PDF).",
      "Approve/reject actions are recorded in Action History with your name.",
    ],
  },
  {
    icon: MapPin,
    title: "Locations",
    where: "Sidebar → Locations",
    what: "Work sites with address and an optional GPS geofence (latitude, longitude, radius). The geofence is what makes worker check-ins auto-detect their site.",
    steps: [
      "Click Add Location, enter the name and address.",
      "Add latitude/longitude and a radius in metres to enable geofenced check-in for that site.",
      "Edit or delete locations at any time — changes are logged.",
    ],
    notes: ["A check-in outside every geofence is still allowed but flagged 'Location Mismatch' with the nearest site and distance shown to you."],
  },
  {
    icon: MapPinned,
    title: "Live Map",
    where: "Sidebar → Live Map",
    what: "A live map of everyone currently checked in, plotted at their check-in GPS position, refreshing automatically.",
    steps: [
      "Open Live Map to see markers for every open shift.",
      "Click a marker for the worker's name, site and check-in time.",
    ],
  },
  {
    icon: CalendarCheck,
    title: "Daily Assignments & Bulk Assign",
    where: "Sidebar → Daily Assignments",
    what: "Plan who works where per day. Single assignments, or Bulk Assign to send many workers to one site — optionally repeating weekly until an end date. Workers are emailed their assignments, and today's view shows live check-in match status.",
    steps: [
      "New Assignment → pick worker, location, date. If the worker already has one that day it updates in place.",
      "Bulk Assign → tick multiple workers (or Select all), pick location and start date.",
      "Turn on Repeat weekly and choose the weekday + until date for recurring rotas.",
      "Today's table shows each assignee as Not checked in / Match / MISMATCH in real time.",
      "One bulk action creates a single Action History entry listing every worker.",
    ],
  },
  {
    icon: Building2,
    title: "Clients (reference records)",
    where: "Sidebar → Clients",
    what: "Internal admin-only records of the companies you supply workers to: company name, address, phone, email, which locations belong to them, Active/Inactive status and free-text notes. Clients never sign in — this page is for your records only.",
    steps: [
      "Add Client → company name plus any contact details (email, phone, address).",
      "Tick the locations that belong to the client, set a status, add notes, then save.",
      "Use the row actions to edit or delete a record.",
    ],
  },
  {
    icon: FileText,
    title: "Documents & E-Signatures",
    where: "Sidebar → Documents",
    what: "Upload document templates (with placeholders), send them to workers for e-signature, and track every request: sent, viewed, signed, declined — with a full audit trail.",
    steps: [
      "Upload a template (PDF or text with placeholders like worker name).",
      "Send to one or more workers — they see it on their dashboard under 'Documents to Sign'.",
      "The worker reviews and signs by drawing, typing or uploading a signature.",
      "Track status per request; view the signed copy and the audit trail (sent/viewed/signed timestamps).",
    ],
  },
  {
    icon: Scale,
    title: "Buyer & Profit/Loss",
    where: "Sidebar → Buyer & Profit/Loss",
    what: "Record income from buyers/clients and other business costs. Combined with payroll (labour cost), it produces your profit/loss position.",
    steps: [
      "Add Buyer Income rows: buyer name, description, amount, date, Received/Pending.",
      "Add Other Costs for non-labour expenses.",
      "The summary computes income − labour − costs = profit, with margin.",
    ],
    notes: ["Keep buyer names consistent with the matching Clients records."],
  },
  {
    icon: BarChart3,
    title: "Reports",
    where: "Sidebar → Reports",
    what: "Date-range reporting across attendance, labour cost, billing, payroll runs, signature requests and holiday accrual, filterable by worker and location, exportable as CSV or PDF.",
    steps: [
      "Pick a From/To range and optionally a worker or location.",
      "Review total hours, labour cost, payroll issued, profit/margin and per-location breakdowns.",
      "Click Export → CSV for spreadsheets or PDF for a formatted summary.",
    ],
  },
  {
    icon: TriangleAlert,
    title: "Incidents",
    where: "Sidebar → Incidents",
    what: "Worker-submitted incident reports (Theft, Injury, Property Damage, Altercation, Safety Hazard, Other) with attachments. You triage severity and status, keep internal notes invisible to workers, and export a PDF summary.",
    steps: [
      "New incidents arrive with status Open and a notification is raised for you.",
      "Filter the list by status, severity, location or date range; click a row for detail.",
      "Set Severity (Low → Critical) and move Status through Open → Under Review → Resolved → Closed.",
      "Add internal notes — each stores your name and timestamp; workers never see these.",
      "View photo/PDF attachments in the secure viewer; click Export as PDF for a formatted incident report.",
    ],
  },
  {
    icon: History,
    title: "Action History (Audit Log)",
    where: "Sidebar → SYSTEM → Action History",
    what: "A permanent audit trail of every meaningful action: approvals, payroll generation, attendance edits, location/settings changes, assignments, incidents, client management, worker deletion and more — with who, what, when.",
    steps: [
      "Filter by date range, actor name/ID, actor type (admin/worker/system) or action type.",
      "Each row shows the timestamp, actor, action, target and details.",
      "Use it to answer 'who changed this?' — e.g. a missing worker will show a deleted_worker entry with the admin's name.",
    ],
  },
  {
    icon: Bell,
    title: "Notifications & Expiry Alerts",
    where: "Sidebar → Notifications",
    what: "In-app alerts: contract expiry reminders (30/7-day, configurable), visa expiry warnings (90-day window, hard check-in block once expired), assignment mismatches and new incident reports.",
    steps: [
      "Open Notifications for the full list, newest first, colour-coded by urgency.",
      "Contract & visa expiry notices generate automatically from worker records.",
      "Delete notifications you've handled.",
    ],
  },
  {
    icon: Settings,
    title: "Settings",
    where: "Sidebar → Settings",
    what: "System-wide values used by payroll and alerts: default hourly rate, overtime multiplier & threshold, tax/NI/pension rates, max advance, holiday accrual %, contract length, reminder days, company name and billing multiplier.",
    steps: [
      "Change any value and Save — the change takes effect for future calculations only.",
      "Every settings change is written to Action History with before/after values.",
    ],
    notes: ["Statutory holiday accrual defaults to 12.07% (the standard rate for casual workers)."],
  },
];

const WORKER_TOPICS: Topic[] = [
  {
    icon: KeyRound,
    title: "Account setup & login",
    where: "Login page → Worker tab",
    what: "After an admin approves your registration, you receive an email with your Worker Code and a password-setup link.",
    steps: [
      "Open the setup link from the email and choose a password.",
      "On the login page choose the Worker tab, enter your Worker Code (WKR-….) and password.",
      "Use 'Forgot password?' any time to get a reset email.",
    ],
  },
  {
    icon: Smartphone,
    title: "GPS check-in / check-out",
    where: "Worker Dashboard → Today's Attendance",
    what: "Check-in requires your live GPS position. The system auto-detects which site you're at from the configured geofences — you never pick a location manually.",
    steps: [
      "Tap 'Turn on location' and allow location access in your browser.",
      "When coordinates show, tap Check In.",
      "At the end of your shift tap Check Out — hours and holiday accrual are calculated automatically.",
    ],
    notes: [
      "If your visa has expired, check-in is blocked — contact your administrator.",
      "Being outside all geofences still checks you in but flags it for admin review.",
    ],
  },
  {
    icon: Clock,
    title: "My attendance history",
    where: "Worker Dashboard → My Attendance History",
    what: "Every shift you've worked: date, location, in/out times, hours and whether it was self-recorded or entered by admin.",
    steps: ["Scroll the table on your dashboard — newest shifts first."],
  },
  {
    icon: FileSignature,
    title: "Signing documents",
    where: "Worker Dashboard → Documents to Sign",
    what: "Documents your admin sends for e-signature appear here until actioned.",
    steps: [
      "Tap Review & Sign on a pending document.",
      "Read it, then sign by drawing, typing your name, or uploading a signature image.",
      "Or decline it — either way the admin sees the outcome and timestamp.",
    ],
  },
  {
    icon: TriangleAlert,
    title: "Reporting an incident",
    where: "Worker Dashboard → Incident Reports",
    what: "Report anything that happens on site — theft, injury, property damage, altercation, safety hazard or other — straight to the admin team, optionally with a photo or document.",
    steps: [
      "Tap Report an Incident.",
      "Pick a category; if you're checked in, your site is pre-selected.",
      "Describe what happened and optionally attach a photo/PDF (max 3 MB).",
      "Submit — you'll see its status (Open / Under Review / Resolved / Closed) update in your list.",
    ],
    notes: ["Admin internal notes on your report are never visible to you — you only see the status."],
  },
];

/* Feature status checklist — everything shipped */
const FEATURE_STATUS: [string, string][] = [
  ["Admin / Worker login (JWT)", "Active"],
  ["Public 5-step registration + drafts + 3MB uploads", "Active"],
  ["Approval → worker creation → setup email", "Active"],
  ["GPS geofenced check-in/out + mismatch flags", "Active"],
  ["Visa-expiry check-in block", "Active"],
  ["Attendance (self + manual) + holiday accrual 12.07%", "Active"],
  ["Payroll (overtime, tax/NI, bank holidays, accrual pay)", "Active"],
  ["Worker Directory + BS7858 compliance checklist", "Active"],
  ["Registration documents secure viewer", "Active"],
  ["Locations + geofences + Live Map", "Active"],
  ["Daily assignments + Bulk / weekly recurring assign", "Active"],
  ["Assignment emails to workers", "Active"],
  ["E-signature documents + audit trail", "Active"],
  ["Buyer income, other costs, profit/loss", "Active"],
  ["Reports + CSV/PDF export", "Active"],
  ["Incident reporting + triage + PDF export", "Active"],
  ["Action History audit log", "Active"],
  ["Notifications + contract/visa expiry alerts", "Active"],
  ["Client reference records (admin-only)", "Active"],
  ["Auto-logout on expired session", "Active"],
];

const FAQS: [string, string][] = [
  ["How do I approve a new worker?", "Registration Approvals → click the application → review details and documents → Approve. A worker code is created and the password-setup email is sent automatically."],
  ["How is net pay calculated?", "Attendance hours × hourly rate, plus overtime above the threshold and bank-holiday uplift, plus statutory holiday accrual pay, minus tax, NI and any advance — all rates from Settings."],
  ["Why is a check-in flagged 'Location Mismatch'?", "The worker's GPS position was outside every configured geofence. The nearest site and distance are stored so you can judge whether it's legitimate."],
  ["A worker can't check in — why?", "Most commonly: their visa has expired (hard block), their contract has expired, or they denied location access in the browser. Check their Worker Details page."],
  ["Can a client sign in to see their own data?", "No — Clients are internal reference records (company details + linked locations). There is no client login or portal."],
  ["Who deleted or changed something?", "Action History (SYSTEM section) records every meaningful action with the actor's name and timestamp — filter by action type or date."],
  ["When are expiry alerts sent?", "Contract: 30 days and 7 days before expiry (configurable in Settings). Visa: from 90 days before expiry, escalating to critical at 7 days."],
  ["What's the maximum upload size?", "3 MB per file everywhere (registration documents and incident attachments). JPG, PNG and PDF are accepted."],
  ["Why does the date picker show mm/dd/yyyy?", "The pop-up calendar is your browser's native widget and follows your operating system's region setting. All dates the system displays and stores are UK format — set Windows Region to United Kingdom for a dd/mm/yyyy picker."],
  ["Can a worker see admin incident notes?", "No. Internal notes on incidents are admin-only; workers only see their report's status."],
];

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */

const PANELS = [
  { key: "admin", label: "Admin Panel", topics: ADMIN_TOPICS },
  { key: "worker", label: "Worker Portal", topics: WORKER_TOPICS },
] as const;

function TopicCard({ topic, forceOpen }: { topic: Topic; forceOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <topic.icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{topic.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{topic.where}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="border-t border-border px-4 pt-3 pb-4">
          <p className="text-sm text-muted-foreground">{topic.what}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-primary">How to use</p>
          <ol className="mt-1.5 space-y-1.5">
            {topic.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {topic.notes && topic.notes.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {topic.notes.map((n, i) => (
                <p key={i} className="flex gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /> {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HelpPage() {
  const [panel, setPanel] = useState<(typeof PANELS)[number]["key"] | "faq" | "status">("admin");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const activePanel = PANELS.find((p) => p.key === panel);

  const filteredTopics = useMemo(() => {
    if (!activePanel) return [];
    if (!q) return activePanel.topics;
    return activePanel.topics.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.what.toLowerCase().includes(q) ||
        t.where.toLowerCase().includes(q) ||
        t.steps.some((s) => s.toLowerCase().includes(q)) ||
        (t.notes ?? []).some((n) => n.toLowerCase().includes(q))
    );
  }, [activePanel, q]);

  const filteredFaqs = useMemo(
    () => (q ? FAQS.filter(([a, b]) => a.toLowerCase().includes(q) || b.toLowerCase().includes(q)) : FAQS),
    [q]
  );

  return (
    <AdminShell title="Help & Center">
      <div className="space-y-3">
        {/* Intro cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { icon: BookOpen, title: "Complete guide", desc: "Every feature, panel by panel, with step-by-step instructions below." },
            { icon: MessageCircle, title: "Live chat", desc: "Talk to the support team, Mon–Fri 9–6." },
            { icon: LifeBuoy, title: "Raise a ticket", desc: "Report an issue and track its progress." },
          ].map((c) => (
            <Card key={c.title}>
              <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                <c.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{c.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
            </Card>
          ))}
        </div>

        {/* Search + panel tabs */}
        <Card>
          <div className="relative">
            <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide… e.g. payroll, check-in, incident, client billing"
              className="h-10 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PANELS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPanel(p.key)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium",
                  panel === p.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
                <span className="ml-1.5 text-xs opacity-70">({p.topics.length})</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPanel("status")}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium",
                panel === "status" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              Feature Status
            </button>
            <button
              type="button"
              onClick={() => setPanel("faq")}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium",
                panel === "faq" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              FAQs ({FAQS.length})
            </button>
          </div>

          {/* Topics */}
          {activePanel && (
            <div className="mt-4 space-y-2">
              {filteredTopics.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No topics match "{query}".</p>
              ) : (
                filteredTopics.map((t) => <TopicCard key={t.title} topic={t} forceOpen={Boolean(q)} />)
              )}
            </div>
          )}

          {/* Feature status checklist */}
          {panel === "status" && (
            <div className="mt-4">
              <p className="mb-3 text-sm text-muted-foreground">
                Everything currently shipped and working in this system:
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FEATURE_STATUS.filter(([f]) => !q || f.toLowerCase().includes(q)).map(([feature, status]) => (
                  <div key={feature} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5">
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                    <span className="min-w-0 flex-1 text-sm">{feature}</span>
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">{status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FAQs */}
          {panel === "faq" && (
            <div className="mt-4 divide-y divide-border">
              {filteredFaqs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No FAQs match "{query}".</p>
              ) : (
                filteredFaqs.map(([question, answer]) => (
                  <div key={question} className="py-3.5">
                    <p className="text-sm font-medium">{question}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{answer}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
