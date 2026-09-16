import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2, ArrowLeft, ArrowRight, Plus, Trash2, Check,
  User, Phone, Mail, Calendar, MapPin, Hash, Landmark, FileText, Upload, X,
  Briefcase, Globe, Clock, ShieldCheck, CircleDashed, ChevronDown, Search,
} from "lucide-react";
import { Card, Field, PrimaryButton, GhostButton, inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { HOW_HEARD_OPTIONS } from "@/lib/mock-data";
import { COUNTRIES, requiresVisa } from "@/lib/countries";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Worker Registration — WorkHR" },
      { name: "description", content: "Complete the 5-step application form to apply for work. Applications go straight to the HR approvals queue." },
      { property: "og:title", content: "Worker Registration — WorkHR" },
      { property: "og:description", content: "Complete the 5-step application form to apply for work. Applications go straight to the HR approvals queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegisterPage,
});

const APPLIED_FOR_OPTIONS = [
  "Door Supervisor",
  "Security Officer",
  "Steward",
  "House Keeper",
  "Kitchen Porter",
  "Night Porter",
  "Chefs",
  "Waiter / Waitress",
  "Other",
];
const titles = ["Mr", "Mrs", "Ms", "Miss"];
const availabilityOptions = ["Full-time", "Part-time", "Weekends only", "Flexible"];

/** inputCls without the top margin — used inside custom wrappers that manage their own spacing. */
const inputBase = "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary";

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB
const FILE_ACCEPT = ".jpg,.jpeg,.png,.pdf";
const FILE_HINT = "Max file size: 3MB. Accepted formats: JPG, PNG, PDF";

type Row = Record<string, string>;
const g = (r: Row, k: string) => r[k] ?? "";

const blankPrevAddress: Row = { line1: "", line2: "", line3: "", town: "", postcode: "", country: "", from: "", to: "" };
const blankEmployer: Row = { name: "", address: "", town: "", postcode: "", phone: "", email: "", role: "", from: "", to: "", reason: "" };
const blankReferee: Row = { phone: "", email: "", address: "", years: "", relationship: "" };
const blankSkill: Row = { name: "", attained: "", expiry: "", number: "" };

const steps = [
  { name: "Personal Details", icon: User },
  { name: "Documents & Eligibility", icon: FileText },
  { name: "Work History", icon: Briefcase },
  { name: "Skills & Availability", icon: Clock },
  { name: "Review & Submit", icon: ShieldCheck },
];

/** Input rendered with a leading icon (used inside <Field>). */
function IconInput({ icon, children }: { icon: React.ReactNode; children: React.ReactElement }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      {children}
    </div>
  );
}

const iconCls = "pl-9"; // extra left padding for inputs rendered inside IconInput

function Section({ title, icon, children, cols = 2 }: { title: string; icon?: React.ReactNode; children: React.ReactNode; cols?: number }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4 first:mt-0 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-primary">
        {icon && <span className="grid size-6 place-items-center rounded-md bg-primary-soft text-primary [&>svg]:size-3.5">{icon}</span>}
        {title}
      </h3>
      <div className={cols === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>{children}</div>
    </div>
  );
}

function Repeat({
  title,
  rows,
  onAdd,
  onRemove,
  children,
  min = 0,
  optional = false,
}: {
  title: string;
  rows: Row[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  children: (row: Row, i: number) => React.ReactNode;
  min?: number;
  optional?: boolean;
}) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-primary">
          {title}
          {optional && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">optional</span>}
        </h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-secondary"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      <div className="grid gap-4">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">None added — click “Add” to include one.</p>}
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {title} {i + 1}
              </span>
              {rows.length > min && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label="Remove"
                  className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">{children(row, i)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({ title, items }: { title: string; items: [string, string][] }) {
  const filled = items.filter(([, v]) => v && v.trim());
  if (!filled.length) return null;
  return (
    <div className="mt-5 first:mt-0">
      <h3 className="mb-2 text-sm font-semibold tracking-tight text-primary">{title}</h3>
      <dl className="grid gap-x-6 gap-y-1.5 rounded-xl border border-border p-4 sm:grid-cols-2">
        {filled.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const Req = () => <span className="text-danger"> *</span>;

/**
 * Custom searchable country dropdown — European countries only.
 * One shared implementation used for every country field in the form.
 */
function CountrySelect({
  value,
  onChange,
  invalid,
  placeholder = "Select country…",
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = COUNTRIES.filter((c) =>
    c.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div ref={boxRef} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
        className={`${inputBase} flex items-center gap-2 text-left ${invalid ? "border-danger" : ""} ${open ? "border-primary" : ""}`}
      >
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <span className={`flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>
          {value || placeholder}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtered.length) {
                    e.preventDefault();
                    onChange(filtered[0]!);
                    setOpen(false);
                  }
                }}
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary"
                placeholder="Type to search…"
              />
            </div>
          </div>
          <ul className="max-h-52 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No countries match “{q}”.</li>
            )}
            {filtered.map((c) => {
              const sel = c === value;
              return (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary ${
                      sel ? "bg-primary-soft font-medium text-primary" : ""
                    }`}
                  >
                    <span className="flex-1">{c}</span>
                    {sel && <Check className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** File upload with preview, size/format validation and remove option. */
function FileUpload({
  label,
  required,
  fileName,
  preview,
  helper,
  onPick,
  onClear,
  error,
}: {
  label: string;
  required?: boolean;
  fileName: string;
  preview?: string | undefined;
  helper?: string | undefined;
  onPick: (f: File | null) => void;
  onClear: () => void;
  error?: string | undefined;
}) {
  const [localErr, setLocalErr] = useState<string | null>(null);
  const isImage = preview?.startsWith("data:image");
  const msg = error ?? localErr;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setLocalErr(`“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)}MB — max file size is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB.`);
      return;
    }
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) {
      setLocalErr("Unsupported format — please use JPG, PNG or PDF.");
      return;
    }
    setLocalErr(null);
    onPick(file);
  };

  return (
    <div>
      <span className="text-sm font-medium">
        {label}
        {required && <Req />}
      </span>
      {fileName ? (
        <div className="mt-1.5 flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
          {isImage ? (
            <img src={preview} alt="" className="size-10 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
              <FileText className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{fileName}</span>
          <button
            type="button"
            onClick={() => {
              setLocalErr(null);
              onClear();
            }}
            aria-label="Remove file"
            className="grid size-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-danger"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <label
          className={`mt-1.5 flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary ${
            msg ? "border-danger" : "border-border"
          }`}
        >
          <Upload className="size-4" />
          <span className="text-xs font-medium">Click to upload</span>
          <input type="file" accept={FILE_ACCEPT} className="hidden" onChange={pick} />
        </label>
      )}
      {msg ? (
        <span className="mt-1 block text-xs font-medium text-danger">{msg}</span>
      ) : (
        <span className="mt-1 block text-xs text-muted-foreground">
          {helper && <span className="block">{helper}</span>}
          {FILE_HINT}
        </span>
      )}
    </div>
  );
}

function RegisterPage() {
  const { submitApplication, locations, settings, loadLocations, loading } = useApi();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationSummary, setValidationSummary] = useState<string | null>(null);

  const [f, setF] = useState({
    appliedFor: "",
    title: titles[0]!,
    surname: "",
    forename: "",
    dob: "",
    birthSurname: "",
    nameChangeDate: "",
    mobile: "",
    email: "",
    addr1: "",
    addr2: "",
    addr3: "",
    town: "",
    postcode: "",
    country: "United Kingdom",
    addressFrom: "",
    birthPlace: "",
    nationality: "",
    ni: "",
    rtw: "Yes",
    kinForename: "",
    kinSurname: "",
    kinPhone: "",
    kinAddr1: "",
    kinAddr2: "",
    kinAddr3: "",
    kinTown: "",
    kinPostcode: "",
    kinCountry: "United Kingdom",
    photo: "",
    proofAddress: "",
    passportDoc: "",
    eVisa: "",
    siaDocFront: "",
    siaDocBack: "",
    hasVisa: "No",
    visaType: "",
    visaIssueDate: "",
    visaExpiry: "",
    rtwShareCode: "",
    howHeard: "",
    subcontractCompany: "",
    passportCountry: "United Kingdom",
    passportNumber: "",
    passportIssueDate: "",
    passportExpiry: "",
    siaBadgeNumber: "",
    siaBadgeExpiry: "",
    passportType: "",
    cv: "",
    shareCode: "",
    bankName: "",
    accountHolder: "",
    sortCode: "",
    accountNumber: "",
    medical: "",
    dietary: "",
    workedBefore: "No",
    beforeFrom: "",
    beforeTo: "",
    beforeReason: "",
    availability: availabilityOptions[0]!,
    gdprConsent: "No",
  });
  const [prevAddresses, setPrevAddresses] = useState<Row[]>([]);
  const [employers, setEmployers] = useState<Row[]>([{ ...blankEmployer }]);
  const [referees, setReferees] = useState<Row[]>([{ ...blankReferee }]);
  const [skills, setSkills] = useState<Row[]>([]);
  const [prefLocations, setPrefLocations] = useState<string[]>([]);
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [fileObjects, setFileObjects] = useState<Record<string, File>>({});
  /** Docs already stored on the server by a draft save — satisfy validation without re-upload. */
  const [existingDocs, setExistingDocs] = useState<Record<string, string>>({});
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeEmail, setResumeEmail] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  // GET /api/locations is public — the store only auto-loads it for logged-in
  // sessions, so the registration page must trigger it itself, otherwise the
  // "Preferred Work Location(s)" selector renders nothing.
  useEffect(() => {
    void loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const err = (k: string) => errors[k];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setF((s) => ({ ...s, [k]: v }));
    setErrors((s) => {
      if (!s[k as string]) return s;
      const { [k as string]: _d, ...rest } = s;
      return rest;
    });
  };
  const setVal = (k: keyof typeof f) => (v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((s) => {
      if (!s[k as string]) return s;
      const { [k as string]: _d, ...rest } = s;
      return rest;
    });
  };
  const pickFile = (k: keyof typeof f) => (file: File | null) => {
    setErrors((s) => {
      if (!s[k as string]) return s;
      const { [k as string]: _d, ...rest } = s;
      return rest;
    });
    if (!file) {
      setF((s) => ({ ...s, [k]: "" }));
      setDocUrls((s) => {
        const { [k as string]: _drop, ...rest } = s;
        return rest;
      });
      setFileObjects((s) => {
        const { [k as string]: _drop, ...rest } = s;
        return rest;
      });
      return;
    }
    setF((s) => ({ ...s, [k]: file.name }));
    const reader = new FileReader();
    reader.onload = () => setDocUrls((s) => ({ ...s, [k as string]: String(reader.result) }));
    reader.readAsDataURL(file);
    setFileObjects((s) => ({ ...s, [k as string]: file }));
  };
  const rowSet = (
    setter: React.Dispatch<React.SetStateAction<Row[]>>,
    i: number,
    key: string,
  ) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setter((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  };

  const pct = step * 25;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NI_RE = /^[A-Za-z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-Da-d]$/;
  const SORT_RE = /^\d{2}-?\d{2}-?\d{2}$/;
  const ACCOUNT_RE = /^\d{8}$/;

  const FILE_KEYS = ["photo", "proofAddress", "passportDoc", "eVisa", "siaDocFront", "siaDocBack", "cv", "shareCode", "rtwShareCode"];

  /** Latest-state ref so effects/page-leave handlers always build from fresh data. */
  const latestRef = useRef<any>(null);
  latestRef.current = { f, prevAddresses, employers, referees, skills, prefLocations, fileObjects, existingDocs, step };

  /** Shared payload builder — used by both draft autosave and final submit. */
  const buildFormData = (extra?: Record<string, string>) => {
    const s = latestRef.current;
    const formData = new FormData();
    for (const [k, v] of Object.entries(s.f)) {
      if (!FILE_KEYS.includes(k)) formData.append(k, String(v));
    }
    // Backend keeps the combined sortAccount field; send both granular + combined
    formData.append('sortAccount', [s.f.sortCode, s.f.accountNumber].filter(Boolean).join(' / '));
    formData.append('prevAddresses', JSON.stringify(s.prevAddresses));
    formData.append('employers', JSON.stringify(s.employers));
    formData.append('referees', JSON.stringify(s.referees));
    formData.append('skills', JSON.stringify(s.skills));
    formData.append('prefLocations', JSON.stringify(s.prefLocations));
    formData.append('existingDocs', JSON.stringify(s.existingDocs));
    for (const k of FILE_KEYS) {
      const existingName = s.existingDocs[k] ? s.existingDocs[k].split('/').pop() : '';
      // Only upload a file if it is newly selected or changed from the saved one
      if (s.fileObjects[k] && s.f[k] !== existingName) {
        formData.append(k, s.fileObjects[k]);
      }
    }
    if (extra) for (const [k, v] of Object.entries(extra)) formData.append(k, v);
    return formData;
  };

  /** Silently save progress to the backend so the applicant can resume later. */
  const saveDraft = async (completedStep: number) => {
    const s = latestRef.current;
    if (!s || !EMAIL_RE.test(s.f.email.trim())) return;
    try {
      const res = await apiClient.uploadFile<{ id: string; docUrls: Record<string, string> }>(
        '/applications/draft',
        buildFormData({ lastStep: String(completedStep) }),
      );
      setExistingDocs((prev) => ({ ...prev, ...res.docUrls }));
      setFileObjects((prev) => {
        const next = { ...prev };
        for (const k of FILE_KEYS) {
          if (res.docUrls[k] && next[k]) delete next[k];
        }
        return next;
      });
      setDraftSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }));
    } catch (e) {
      console.warn('Draft save failed:', e);
    }
  };

  // Debounced autosave — 2.5s after the last *actual change*, once a valid
  // email exists. A fingerprint of the form state prevents the save→render→
  // re-save loop (setDraftSavedAt triggers a render, which must not re-arm).
  const lastSavedFp = useRef("");
  const fingerprint = JSON.stringify({
    f,
    prevAddresses,
    employers,
    referees,
    skills,
    prefLocations,
    files: FILE_KEYS.map((k) => fileObjects[k] ? `${fileObjects[k].name}:${fileObjects[k].size}` : existingDocs[k] || ""),
    step,
  });
  useEffect(() => {
    if (!EMAIL_RE.test(f.email.trim())) return;
    if (fingerprint === lastSavedFp.current) return; // nothing new since last save
    const fp = fingerprint;
    const t = setTimeout(() => {
      lastSavedFp.current = fp;
      void saveDraft(step);
    }, 2500);
    return () => clearTimeout(t);
  });

  // Flush a final save when the tab is hidden or closed — best effort.
  useEffect(() => {
    const flush = () => {
      const s = latestRef.current;
      if (!s || !EMAIL_RE.test(s.f.email.trim())) return;
      try {
        const base = (import.meta as any).env?.['VITE_API_URL'] || ((import.meta as any).env?.DEV ? 'http://localhost:3001' : '');
        fetch(`${base}/api/applications/draft`, {
          method: 'POST',
          body: buildFormData({ lastStep: String(s.step) }),
          keepalive: true,
        });
      } catch { /* best effort */ }
    };
    const onVis = () => { if (document.hidden) flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load a saved draft back into the form. */
  const resumeDraft = async () => {
    const email = resumeEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setResumeMsg('Please enter a valid email address');
      return;
    }
    setResumeBusy(true);
    setResumeMsg(null);
    try {
      const res = await apiClient.get<{ id: string; details: Record<string, any> }>(
        `/api/applications/draft?email=${encodeURIComponent(email)}`,
      );
      const d = res.details;
      setF((s) => {
        const next = { ...s };
        for (const k of Object.keys(next) as (keyof typeof s)[]) {
          if (typeof d[k] === 'string') (next as any)[k] = d[k];
        }
        return next;
      });
      // Repeat-row arrays are stored as JSON strings inside details — parse them
      const asRows = (v: any): Row[] => {
        if (Array.isArray(v)) return v;
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
      };
      const prevA = asRows(d["prevAddresses"]);
      if (prevA.length) setPrevAddresses(prevA);
      const emps = asRows(d["employers"]);
      if (emps.length) setEmployers(emps);
      const refs = asRows(d["referees"]);
      if (refs.length) setReferees(refs);
      const sks = asRows(d["skills"]);
      if (sks.length) setSkills(sks);
      const locs = asRows(d["prefLocations"]);
      if (locs.length) setPrefLocations(locs.map(String));
      // Previously uploaded docs are already on the server — mark them done
      const docs: Record<string, string> = d["docUrls"] || {};
      setExistingDocs(docs);
      setF((s) => {
        const next = { ...s };
        for (const k of FILE_KEYS) {
          if (docs[k]) (next as any)[k] = docs[k].split('/').pop()!;
        }
        return next;
      });
      setErrors({});
      setResumed(true);
      setResumeOpen(false);
      const last = Number(d["lastStep"]);
      if (last >= 1 && last <= 4) goTo(Math.min(4, last));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setResumeMsg('No saved application found for that email.');
    } finally {
      setResumeBusy(false);
    }
  };

  // Visa details are expected for non-UK/Irish passport holders, or anyone who
  // answered "Yes" to holding a work permit/visa. Hidden entirely otherwise.
  const visaNeeded = requiresVisa(f.passportCountry);
  const showVisaFields = f.hasVisa === "Yes" || visaNeeded;
  const visaMissing = visaNeeded && !(f.visaIssueDate && f.visaExpiry && f.rtwShareCode);

  /* ---------------- per-step validation ---------------- */

  const need = (acc: Record<string, string>, key: string, label: string, val?: string) => {
    if (!val || !val.trim()) acc[key] = `Please enter ${label}`;
  };
  const rowNeed = (acc: Record<string, string>, prefix: string, i: number, key: string, label: string, row: Row) => {
    if (!g(row, key).trim()) acc[`${prefix}${i}.${key}`] = `Please enter ${label}`;
  };

  const validateStep = (n: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (n === 0) {
      need(e, "appliedFor", "the position you are applying for", f.appliedFor);
      need(e, "surname", "your surname", f.surname);
      need(e, "forename", "your forename", f.forename);
      need(e, "dob", "your date of birth", f.dob);
      if (!f.mobile.trim()) e["mobile"] = "Please enter your mobile number";
      else if (!/^[\d\s+()-]{7,}$/.test(f.mobile.trim())) e["mobile"] = "Please enter a valid phone number";
      if (!f.email.trim()) e["email"] = "Please enter your email address";
      else if (!EMAIL_RE.test(f.email.trim())) e["email"] = "Please enter a valid email address";
      need(e, "addr1", "the first line of your address", f.addr1);
      need(e, "town", "your town or city", f.town);
      need(e, "postcode", "your postcode", f.postcode);
      need(e, "country", "your country", f.country);
      need(e, "addressFrom", "the date you moved to this address", f.addressFrom);
      prevAddresses.forEach((r, i) => {
        rowNeed(e, "prev", i, "line1", "the address line 1", r);
        rowNeed(e, "prev", i, "town", "the town", r);
        rowNeed(e, "prev", i, "postcode", "the postcode", r);
        rowNeed(e, "prev", i, "country", "the country", r);
        rowNeed(e, "prev", i, "from", "the start date", r);
        rowNeed(e, "prev", i, "to", "the end date", r);
      });
      need(e, "birthPlace", "your town / place of birth", f.birthPlace);
      need(e, "nationality", "your nationality", f.nationality);
      need(e, "kinForename", "their forename", f.kinForename);
      need(e, "kinSurname", "their surname", f.kinSurname);
      need(e, "kinPhone", "their phone number", f.kinPhone);
      need(e, "kinAddr1", "the first line of their address", f.kinAddr1);
      need(e, "kinTown", "their town or city", f.kinTown);
      need(e, "kinPostcode", "their postcode", f.kinPostcode);
      need(e, "kinCountry", "their country", f.kinCountry);
    }
    if (n === 1) {
      if (!f.ni.trim()) e["ni"] = "Please enter your National Insurance number";
      else if (!NI_RE.test(f.ni.trim())) e["ni"] = "Please enter a valid NI number (e.g. QQ 12 34 56 C)";
      need(e, "eVisa", "your eVisa document", f.eVisa);
      need(e, "photo", "a profile photo", f.photo);
      need(e, "proofAddress", "a proof of address document", f.proofAddress);
      if (!f.passportType) e["passportType"] = "Please select your passport type";
      else if (f.passportType === "British Passport") need(e, "shareCode", "your UKVI share code", f.shareCode);
      else if (f.passportType === "Other Passport") need(e, "cv", "your CV including 5 years of address history", f.cv);
      need(e, "passportCountry", "your passport country", f.passportCountry);
      need(e, "passportNumber", "your passport number", f.passportNumber);
      need(e, "passportIssueDate", "your passport issue date", f.passportIssueDate);
      need(e, "passportExpiry", "your passport expiry date", f.passportExpiry);
      need(e, "passportDoc", "a photo/scan of your passport", f.passportDoc);
      if (showVisaFields) {
        need(e, "visaType", "your visa type", f.visaType);
        need(e, "visaIssueDate", "your visa issue date", f.visaIssueDate);
        need(e, "visaExpiry", "your visa expiry date", f.visaExpiry);
        need(e, "rtwShareCode", "your right-to-work share code", f.rtwShareCode);
      }
      if (f.siaBadgeNumber.trim() || f.siaBadgeExpiry) {
        need(e, "siaBadgeNumber", "your SIA badge number", f.siaBadgeNumber);
        need(e, "siaBadgeExpiry", "your SIA badge expiry date", f.siaBadgeExpiry);
        need(e, "siaDocFront", "the front of your SIA badge", f.siaDocFront);
        need(e, "siaDocBack", "the back of your SIA badge", f.siaDocBack);
      }
      need(e, "bankName", "your bank name", f.bankName);
      need(e, "accountHolder", "the account holder name", f.accountHolder);
      if (!f.sortCode.trim()) e["sortCode"] = "Please enter your sort code";
      else if (!SORT_RE.test(f.sortCode.trim())) e["sortCode"] = "Sort code must be 6 digits (e.g. 12-34-56)";
      if (!f.accountNumber.trim()) e["accountNumber"] = "Please enter your account number";
      else if (!ACCOUNT_RE.test(f.accountNumber.trim())) e["accountNumber"] = "Account number must be 8 digits";
    }
    if (n === 2) {
      if (f.workedBefore === "Yes") {
        need(e, "beforeFrom", "the start date", f.beforeFrom);
        need(e, "beforeTo", "the end date", f.beforeTo);
        need(e, "beforeReason", "the reason for leaving", f.beforeReason);
      }
      employers.forEach((r, i) => {
        rowNeed(e, "emp", i, "name", "the employer / organisation name", r);
        rowNeed(e, "emp", i, "role", "your role / position", r);
        rowNeed(e, "emp", i, "from", "the start date", r);
        rowNeed(e, "emp", i, "to", "the end date", r);
        if (g(r, "email").trim() && !EMAIL_RE.test(g(r, "email").trim()))
          e[`emp${i}.email`] = "Please enter a valid email address";
      });
      referees.forEach((r, i) => {
        rowNeed(e, "ref", i, "phone", "the referee phone", r);
        if (!g(r, "email").trim()) e[`ref${i}.email`] = "Please enter the referee email";
        else if (!EMAIL_RE.test(g(r, "email").trim())) e[`ref${i}.email`] = "Please enter a valid email address";
        rowNeed(e, "ref", i, "years", "the years known", r);
        rowNeed(e, "ref", i, "relationship", "the relationship", r);
      });
    }
    if (n === 3) {
      skills.forEach((r, i) => {
        rowNeed(e, "skill", i, "name", "the qualification / certificate name", r);
      });
      need(e, "howHeard", "how you heard about us", f.howHeard);
      if (f.howHeard === "Sub-contract") need(e, "subcontractCompany", "the sub-contract company name", f.subcontractCompany);
    }
    return e;
  };

  const validateAll = (): { step: number; errors: Record<string, string> } | null => {
    for (let n = 0; n <= 3; n++) {
      const e = validateStep(n);
      if (Object.keys(e).length) return { step: n, errors: e };
    }
    return null;
  };

  const goTo = (n: number) => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = () => {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setValidationSummary(null);
    const nxt = Math.min(4, step + 1);
    goTo(nxt);
    void saveDraft(nxt); // autosave progress after every completed step
  };

  const submit = async () => {
    const bad = validateAll();
    if (bad) {
      const stepNames = ["Personal Details", "Documents & Eligibility", "Work History", "Skills & Availability"];
      const msgs = Object.values(bad.errors);
      const list = msgs.slice(0, 5).join("; ");
      const more = msgs.length > 5 ? ` and ${msgs.length - 5} more` : "";
      setValidationSummary(`${stepNames[bad.step]}: ${list}${more}. Please review the highlighted fields.`);
      setErrors(bad.errors);
      goTo(bad.step);
      return;
    }
    setValidationSummary(null);
    const newErrors: Record<string, string> = {};
    if (!confirmed) newErrors["confirmed"] = "Please confirm the information is accurate";
    if (f.gdprConsent !== "Yes") newErrors["gdprConsent"] = "Please consent to WorkHR storing and processing your personal data";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }
    setSubmitting(true);
    try {
      const response = await submitApplication(buildFormData());
      setDone(response.id);
    } catch (error) {
      console.error('Submission error:', error);
      setErrors({ ["submit"]: 'Failed to submit application. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell step={step} maxStep={maxStep} onStep={() => {}}>
        <Card className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <h1 className="mt-3 text-xl font-bold tracking-tight">Application submitted successfully</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Our team will review and contact you shortly. Your reference is <strong>{done}</strong>.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link to="/" className="text-sm font-medium text-primary">
              Back to home
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Shell step={step} maxStep={maxStep} onStep={goTo}>
      <div className="mb-5 lg:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Worker Registration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Step {step + 1} of 5 — {steps[step]!.name}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.max(pct, 8)}%` }}
          />
        </div>
      </div>

      {/* resume a saved draft */}
      {!resumed && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setResumeOpen((o) => !o)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Already started an application? Resume here
          </button>
          {resumeOpen && (
            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={resumeEmail}
                  onChange={(e) => setResumeEmail(e.target.value)}
                  className={`${inputBase} pl-9`}
                  placeholder="Enter the email you used"
                />
              </div>
              <PrimaryButton onClick={resumeDraft} disabled={resumeBusy} className="sm:flex-none">
                {resumeBusy ? "Checking…" : "Find my application"}
              </PrimaryButton>
            </div>
          )}
          {resumeMsg && <p className="mt-1 text-xs font-medium text-danger">{resumeMsg}</p>}
        </div>
      )}
      {resumed && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-success/40 bg-success-soft px-4 py-2.5 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" /> Your saved progress has been restored — continue where you left off.
        </p>
      )}
      {draftSavedAt && !resumed && (
        <p className="mb-4 text-xs text-muted-foreground">
          Progress auto-saved at {draftSavedAt} — you can safely close this page and resume later via your email.
        </p>
      )}

      <Card className="pb-6">
        <div className="mb-4 hidden items-baseline justify-between lg:flex">
          <h2 className="text-lg font-semibold tracking-tight">{steps[step]!.name}</h2>
          <span className="text-xs text-muted-foreground">Step {step + 1} of 5</span>
        </div>
        {hasErrors && (
          <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
            {validationSummary || "Some fields need your attention — please review the highlighted fields below."}
          </p>
        )}

        {step === 0 && (
          <>
            <Field label="Job / Position applied for *" error={err("appliedFor")}>
              <select value={f.appliedFor} onChange={set("appliedFor")} className={`${inputCls} ${err("appliedFor") ? "border-danger" : ""}`}>
                <option value="">Select a position…</option>
                {APPLIED_FOR_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>

            <Section title="Personal Details" icon={<User />}>
              <Field label="Title *">
                <select value={f.title} onChange={set("title")} className={inputCls}>
                  {titles.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Surname *" error={err("surname")}>
                <IconInput icon={<User />}>
                  <input value={f.surname} onChange={set("surname")} className={`${inputCls} ${iconCls} ${err("surname") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Forename *" error={err("forename")}>
                <IconInput icon={<User />}>
                  <input value={f.forename} onChange={set("forename")} className={`${inputCls} ${iconCls} ${err("forename") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Date of Birth *" error={err("dob")}>
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.dob} onChange={set("dob")} className={`${inputCls} ${iconCls} ${err("dob") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Surname at Birth" hint="Only if different from your current surname">
                <IconInput icon={<User />}>
                  <input value={f.birthSurname} onChange={set("birthSurname")} className={`${inputCls} ${iconCls}`} />
                </IconInput>
              </Field>
              <Field label="Date of Name Change" hint="Only if applicable">
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.nameChangeDate} onChange={set("nameChangeDate")} className={`${inputCls} ${iconCls}`} />
                </IconInput>
              </Field>
            </Section>

            <Section title="Contact Information" icon={<Phone />}>
              <Field label="Mobile *" error={err("mobile")}>
                <IconInput icon={<Phone />}>
                  <input type="tel" value={f.mobile} onChange={set("mobile")} className={`${inputCls} ${iconCls} ${err("mobile") ? "border-danger" : ""}`} placeholder="+44 7700 900000" />
                </IconInput>
              </Field>
              <Field label="Email *" error={err("email")}>
                <IconInput icon={<Mail />}>
                  <input type="email" value={f.email} onChange={set("email")} className={`${inputCls} ${iconCls} ${err("email") ? "border-danger" : ""}`} placeholder="you@example.com" />
                </IconInput>
              </Field>
            </Section>

            <Section title="Current Address" icon={<MapPin />}>
              <Field label="Address Line 1 *" className="sm:col-span-2" error={err("addr1")}>
                <IconInput icon={<MapPin />}>
                  <input value={f.addr1} onChange={set("addr1")} className={`${inputCls} ${iconCls} ${err("addr1") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Address Line 2">
                <input value={f.addr2} onChange={set("addr2")} className={inputCls} />
              </Field>
              <Field label="Address Line 3">
                <input value={f.addr3} onChange={set("addr3")} className={inputCls} />
              </Field>
              <Field label="Town *" error={err("town")}>
                <input value={f.town} onChange={set("town")} className={`${inputCls} ${err("town") ? "border-danger" : ""}`} />
              </Field>
              <Field label="Postcode *" error={err("postcode")}>
                <input value={f.postcode} onChange={set("postcode")} className={`${inputCls} ${err("postcode") ? "border-danger" : ""}`} />
              </Field>
              <Field label="Country *" error={err("country")}>
                <CountrySelect value={f.country} onChange={setVal("country")} invalid={!!err("country")} />
              </Field>
              <Field label="At Current Address From *" error={err("addressFrom")}>
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.addressFrom} onChange={set("addressFrom")} className={`${inputCls} ${iconCls} ${err("addressFrom") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
            </Section>

            <Repeat
              title="Previous Address"
              optional
              rows={prevAddresses}
              onAdd={() => setPrevAddresses((r) => [...r, { ...blankPrevAddress }])}
              onRemove={(i) => setPrevAddresses((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Address Line 1 *" className="sm:col-span-2" error={err(`prev${i}.line1`)}>
                    <input value={g(row,"line1")} onChange={rowSet(setPrevAddresses, i, "line1")} className={`${inputCls} ${err(`prev${i}.line1`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Address Line 2">
                    <input value={g(row,"line2")} onChange={rowSet(setPrevAddresses, i, "line2")} className={inputCls} />
                  </Field>
                  <Field label="Address Line 3">
                    <input value={g(row,"line3")} onChange={rowSet(setPrevAddresses, i, "line3")} className={inputCls} />
                  </Field>
                  <Field label="Town *" error={err(`prev${i}.town`)}>
                    <input value={g(row,"town")} onChange={rowSet(setPrevAddresses, i, "town")} className={`${inputCls} ${err(`prev${i}.town`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Postcode *" error={err(`prev${i}.postcode`)}>
                    <input value={g(row,"postcode")} onChange={rowSet(setPrevAddresses, i, "postcode")} className={`${inputCls} ${err(`prev${i}.postcode`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Country *" error={err(`prev${i}.country`)}>
                    <CountrySelect value={g(row,"country")} onChange={(v) => rowSet(setPrevAddresses, i, "country")({ target: { value: v } })} invalid={!!err(`prev${i}.country`)} />
                  </Field>
                  <Field label="At Address From *" error={err(`prev${i}.from`)}>
                    <input type="date" value={g(row,"from")} onChange={rowSet(setPrevAddresses, i, "from")} className={`${inputCls} ${err(`prev${i}.from`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="At Address To *" error={err(`prev${i}.to`)}>
                    <input type="date" value={g(row,"to")} onChange={rowSet(setPrevAddresses, i, "to")} className={`${inputCls} ${err(`prev${i}.to`) ? "border-danger" : ""}`} />
                  </Field>
                </>
              )}
            </Repeat>

            <Section title="Nationality & Right to Work" icon={<Globe />}>
              <Field label="Town / Place of Birth *" error={err("birthPlace")}>
                <IconInput icon={<MapPin />}>
                  <input value={f.birthPlace} onChange={set("birthPlace")} className={`${inputCls} ${iconCls} ${err("birthPlace") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Nationality *" error={err("nationality")}>
                <CountrySelect value={f.nationality} onChange={setVal("nationality")} invalid={!!err("nationality")} placeholder="Select nationality…" />
              </Field>
              <Field label="Are you permitted to work in the UK? *">
                <select value={f.rtw} onChange={set("rtw")} className={inputCls}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </Field>
            </Section>

            <Section title="Next of Kin / Emergency Contact" icon={<User />}>
              <Field label="Forename *" error={err("kinForename")}>
                <IconInput icon={<User />}>
                  <input value={f.kinForename} onChange={set("kinForename")} className={`${inputCls} ${iconCls} ${err("kinForename") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Surname *" error={err("kinSurname")}>
                <IconInput icon={<User />}>
                  <input value={f.kinSurname} onChange={set("kinSurname")} className={`${inputCls} ${iconCls} ${err("kinSurname") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Phone *" error={err("kinPhone")}>
                <IconInput icon={<Phone />}>
                  <input type="tel" value={f.kinPhone} onChange={set("kinPhone")} className={`${inputCls} ${iconCls} ${err("kinPhone") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <div className="hidden sm:block" />
              <Field label="Address Line 1 *" className="sm:col-span-2" error={err("kinAddr1")}>
                <IconInput icon={<MapPin />}>
                  <input value={f.kinAddr1} onChange={set("kinAddr1")} className={`${inputCls} ${iconCls} ${err("kinAddr1") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Address Line 2">
                <input value={f.kinAddr2} onChange={set("kinAddr2")} className={inputCls} />
              </Field>
              <Field label="Address Line 3">
                <input value={f.kinAddr3} onChange={set("kinAddr3")} className={inputCls} />
              </Field>
              <Field label="Town *" error={err("kinTown")}>
                <input value={f.kinTown} onChange={set("kinTown")} className={`${inputCls} ${err("kinTown") ? "border-danger" : ""}`} />
              </Field>
              <Field label="Postcode *" error={err("kinPostcode")}>
                <input value={f.kinPostcode} onChange={set("kinPostcode")} className={`${inputCls} ${err("kinPostcode") ? "border-danger" : ""}`} />
              </Field>
              <Field label="Country *" error={err("kinCountry")}>
                <CountrySelect value={f.kinCountry} onChange={setVal("kinCountry")} invalid={!!err("kinCountry")} />
              </Field>
            </Section>
          </>
        )}

        {step === 1 && (
          <>
            <Section title="Document Uploads" icon={<Upload />}>
              <FileUpload
                label="Profile Photo"
                required
                fileName={f.photo}
                preview={docUrls["photo"]}
                onPick={pickFile("photo")}
                onClear={() => pickFile("photo")(null)}
                error={err("photo")}
              />
              <FileUpload
                label="Proof of Address"
                required
                fileName={f.proofAddress}
                preview={docUrls["proofAddress"]}
                onPick={pickFile("proofAddress")}
                onClear={() => pickFile("proofAddress")(null)}
                error={err("proofAddress")}
              />
            </Section>

            <Section title="Identity & National Insurance" icon={<ShieldCheck />}>
              <Field label="N.I Number *" error={err("ni")} hint="Example: AB123456C">
                <IconInput icon={<Hash />}>
                  <input value={f.ni} onChange={set("ni")} className={`${inputCls} ${iconCls} ${err("ni") ? "border-danger" : ""}`} placeholder="Insurance Number" />
                </IconInput>
              </Field>
              <FileUpload
                label="Upload eVisa"
                required
                fileName={f.eVisa}
                preview={docUrls["eVisa"]}
                onPick={pickFile("eVisa")}
                onClear={() => pickFile("eVisa")(null)}
                error={err("eVisa")}
              />
            </Section>

            <Section title="Passport" icon={<Globe />}>
              <Field label="Passport type *" error={err("passportType")}>
                <select value={f.passportType} onChange={set("passportType")} className={`${inputCls} ${err("passportType") ? "border-danger" : ""}`}>
                  <option value="">--Select Type--</option>
                  <option>British Passport</option>
                  <option>Other Passport</option>
                </select>
              </Field>
              {f.passportType === "British Passport" && (
                <FileUpload
                  label="Upload your UKVI share code"
                  required
                  fileName={f.shareCode}
                  preview={docUrls["shareCode"]}
                  onPick={pickFile("shareCode")}
                  onClear={() => pickFile("shareCode")(null)}
                  error={err("shareCode")}
                />
              )}
              {f.passportType === "Other Passport" && (
                <FileUpload
                  label="Upload your CV including 5 years of address history"
                  required
                  fileName={f.cv}
                  preview={docUrls["cv"]}
                  onPick={pickFile("cv")}
                  onClear={() => pickFile("cv")(null)}
                  error={err("cv")}
                />
              )}
              <Field label="Passport Country *" error={err("passportCountry")} hint="Which country's passport do you hold? Type to search.">
                <CountrySelect value={f.passportCountry} onChange={setVal("passportCountry")} invalid={!!err("passportCountry")} />
              </Field>
              <Field label="Passport Number *" error={err("passportNumber")}>
                <IconInput icon={<Hash />}>
                  <input value={f.passportNumber} onChange={set("passportNumber")} className={`${inputCls} ${iconCls} ${err("passportNumber") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Passport Issue Date *" error={err("passportIssueDate")}>
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.passportIssueDate} onChange={set("passportIssueDate")} className={`${inputCls} ${iconCls} ${err("passportIssueDate") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Passport Expiry Date *" error={err("passportExpiry")}>
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.passportExpiry} onChange={set("passportExpiry")} className={`${inputCls} ${iconCls} ${err("passportExpiry") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <FileUpload
                label="Passport Document"
                required
                fileName={f.passportDoc}
                preview={docUrls["passportDoc"]}
                onPick={pickFile("passportDoc")}
                onClear={() => pickFile("passportDoc")(null)}
                error={err("passportDoc")}
              />
            </Section>

            <Section title="Right to Work" icon={<ShieldCheck />}>
              <Field label="Are you permitted to work in the UK?">
                <select value={f.hasVisa} onChange={set("hasVisa")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              {showVisaFields && (
                <>
                  <Field label="Visa Type *" error={err("visaType")}>
                    <input value={f.visaType} onChange={set("visaType")} className={`${inputCls} ${err("visaType") ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Visa Issue Date *" error={err("visaIssueDate")}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={f.visaIssueDate} onChange={set("visaIssueDate")} className={`${inputCls} ${iconCls} ${err("visaIssueDate") ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Visa Expiry Date *" error={err("visaExpiry")}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={f.visaExpiry} onChange={set("visaExpiry")} className={`${inputCls} ${iconCls} ${err("visaExpiry") ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <FileUpload
                    label="Upload Share Code to prove your right to work in the UK"
                    required
                    fileName={f.rtwShareCode}
                    preview={docUrls["rtwShareCode"]}
                    onPick={pickFile("rtwShareCode")}
                    onClear={() => pickFile("rtwShareCode")(null)}
                    error={err("rtwShareCode")}
                  />
                </>
              )}
              {visaMissing && (
                <p className="sm:col-span-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-danger">
                  You selected a {f.passportCountry} passport, so visa details are expected. Please add your visa
                  issue date, expiry date and share code.
                </p>
              )}
            </Section>

            <Section title="SIA Badge" icon={<ShieldCheck />}>
              <Field label="SIA Badge Number" hint="Leave blank if you don't hold an SIA badge" error={err("siaBadgeNumber")}>
                <input value={f.siaBadgeNumber} onChange={set("siaBadgeNumber")} className={`${inputCls} ${err("siaBadgeNumber") ? "border-danger" : ""}`} />
              </Field>
              <Field label="SIA Badge Expiry Date" error={err("siaBadgeExpiry")}>
                <IconInput icon={<Calendar />}>
                  <input type="date" value={f.siaBadgeExpiry} onChange={set("siaBadgeExpiry")} className={`${inputCls} ${iconCls} ${err("siaBadgeExpiry") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              {(f.siaBadgeNumber.trim() || f.siaBadgeExpiry) && (
                <>
                  <FileUpload
                    label="SIA Badge Front"
                    required
                    fileName={f.siaDocFront}
                    preview={docUrls["siaDocFront"]}
                    onPick={pickFile("siaDocFront")}
                    onClear={() => pickFile("siaDocFront")(null)}
                    error={err("siaDocFront")}
                  />
                  <FileUpload
                    label="SIA Badge Back"
                    required
                    fileName={f.siaDocBack}
                    preview={docUrls["siaDocBack"]}
                    onPick={pickFile("siaDocBack")}
                    onClear={() => pickFile("siaDocBack")(null)}
                    error={err("siaDocBack")}
                  />
                </>
              )}
            </Section>

            <Section title="Bank Details (for payroll)" icon={<Landmark />}>
              <Field label="Bank Name *" error={err("bankName")}>
                <IconInput icon={<Landmark />}>
                  <input value={f.bankName} onChange={set("bankName")} className={`${inputCls} ${iconCls} ${err("bankName") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Account Holder Name *" error={err("accountHolder")}>
                <IconInput icon={<User />}>
                  <input value={f.accountHolder} onChange={set("accountHolder")} className={`${inputCls} ${iconCls} ${err("accountHolder") ? "border-danger" : ""}`} />
                </IconInput>
              </Field>
              <Field label="Sort Code *" error={err("sortCode")} hint="Format: 12-34-56">
                <IconInput icon={<Hash />}>
                  <input
                    value={f.sortCode}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                      const masked = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join("-");
                      setVal("sortCode")(masked);
                    }}
                    inputMode="numeric"
                    className={`${inputCls} ${iconCls} ${err("sortCode") ? "border-danger" : ""}`}
                    placeholder="12-34-56"
                  />
                </IconInput>
              </Field>
              <Field label="Account Number *" error={err("accountNumber")} hint="8-digit UK account number">
                <IconInput icon={<Hash />}>
                  <input
                    value={f.accountNumber}
                    onChange={(e) => setVal("accountNumber")(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    className={`${inputCls} ${iconCls} ${err("accountNumber") ? "border-danger" : ""}`}
                    placeholder="12345678"
                  />
                </IconInput>
              </Field>
            </Section>

            <Section title="Emergency / Health Info" icon={<FileText />}>
              <Field label="Any medical conditions we should be aware of" hint="Optional" className="sm:col-span-2">
                <input value={f.medical} onChange={set("medical")} className={inputCls} />
              </Field>
              <Field label="Any dietary / accessibility needs" hint="Optional" className="sm:col-span-2">
                <input value={f.dietary} onChange={set("dietary")} className={inputCls} />
              </Field>
            </Section>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="Previous Employment With Us" icon={<Briefcase />}>
              <Field label="Have you worked for this company before?">
                <select value={f.workedBefore} onChange={set("workedBefore")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              {f.workedBefore === "Yes" && (
                <>
                  <Field label="From *" error={err("beforeFrom")}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={f.beforeFrom} onChange={set("beforeFrom")} className={`${inputCls} ${iconCls} ${err("beforeFrom") ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="To *" error={err("beforeTo")}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={f.beforeTo} onChange={set("beforeTo")} className={`${inputCls} ${iconCls} ${err("beforeTo") ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Reason for leaving *" className="sm:col-span-2" error={err("beforeReason")}>
                    <input value={f.beforeReason} onChange={set("beforeReason")} className={`${inputCls} ${err("beforeReason") ? "border-danger" : ""}`} />
                  </Field>
                </>
              )}
            </Section>

            <Repeat
              title="Employment Record"
              rows={employers}
              min={1}
              onAdd={() => setEmployers((r) => [...r, { ...blankEmployer }])}
              onRemove={(i) => setEmployers((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Employer / Organisation Name *" error={err(`emp${i}.name`)}>
                    <IconInput icon={<Briefcase />}>
                      <input value={g(row,"name")} onChange={rowSet(setEmployers, i, "name")} className={`${inputCls} ${iconCls} ${err(`emp${i}.name`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Role / Position *" error={err(`emp${i}.role`)}>
                    <input value={g(row,"role")} onChange={rowSet(setEmployers, i, "role")} className={`${inputCls} ${err(`emp${i}.role`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Address">
                    <input value={g(row,"address")} onChange={rowSet(setEmployers, i, "address")} className={inputCls} />
                  </Field>
                  <Field label="Town">
                    <input value={g(row,"town")} onChange={rowSet(setEmployers, i, "town")} className={inputCls} />
                  </Field>
                  <Field label="Postcode">
                    <input value={g(row,"postcode")} onChange={rowSet(setEmployers, i, "postcode")} className={inputCls} />
                  </Field>
                  <Field label="Phone">
                    <IconInput icon={<Phone />}>
                      <input type="tel" value={g(row,"phone")} onChange={rowSet(setEmployers, i, "phone")} className={`${inputCls} ${iconCls}`} />
                    </IconInput>
                  </Field>
                  <Field label="Email" error={err(`emp${i}.email`)}>
                    <IconInput icon={<Mail />}>
                      <input type="email" value={g(row,"email")} onChange={rowSet(setEmployers, i, "email")} className={`${inputCls} ${iconCls} ${err(`emp${i}.email`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Reason for Leaving">
                    <input value={g(row,"reason")} onChange={rowSet(setEmployers, i, "reason")} className={inputCls} />
                  </Field>
                  <Field label="From *" error={err(`emp${i}.from`)}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={g(row,"from")} onChange={rowSet(setEmployers, i, "from")} className={`${inputCls} ${iconCls} ${err(`emp${i}.from`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="To *" error={err(`emp${i}.to`)}>
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={g(row,"to")} onChange={rowSet(setEmployers, i, "to")} className={`${inputCls} ${iconCls} ${err(`emp${i}.to`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                </>
              )}
            </Repeat>

            <Repeat
              title="Character Referee"
              rows={referees}
              min={1}
              onAdd={() => setReferees((r) => [...r, { ...blankReferee }])}
              onRemove={(i) => setReferees((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Referee Phone *" error={err(`ref${i}.phone`)}>
                    <IconInput icon={<Phone />}>
                      <input type="tel" value={g(row,"phone")} onChange={rowSet(setReferees, i, "phone")} className={`${inputCls} ${iconCls} ${err(`ref${i}.phone`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Referee Email *" error={err(`ref${i}.email`)}>
                    <IconInput icon={<Mail />}>
                      <input type="email" value={g(row,"email")} onChange={rowSet(setReferees, i, "email")} className={`${inputCls} ${iconCls} ${err(`ref${i}.email`) ? "border-danger" : ""}`} />
                    </IconInput>
                  </Field>
                  <Field label="Referee Address">
                    <input value={g(row,"address")} onChange={rowSet(setReferees, i, "address")} className={inputCls} />
                  </Field>
                  <Field label="How many years known *" error={err(`ref${i}.years`)}>
                    <input value={g(row,"years")} onChange={rowSet(setReferees, i, "years")} className={`${inputCls} ${err(`ref${i}.years`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Relationship to you *" error={err(`ref${i}.relationship`)}>
                    <input value={g(row,"relationship")} onChange={rowSet(setReferees, i, "relationship")} className={`${inputCls} ${err(`ref${i}.relationship`) ? "border-danger" : ""}`} />
                  </Field>
                </>
              )}
            </Repeat>
          </>
        )}

        {step === 3 && (
          <>
            <Repeat
              title="Skills & Qualifications"
              optional
              rows={skills}
              onAdd={() => setSkills((r) => [...r, { ...blankSkill }])}
              onRemove={(i) => setSkills((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Qualification / Certificate Name *" error={err(`skill${i}.name`)}>
                    <input value={g(row,"name")} onChange={rowSet(setSkills, i, "name")} className={`${inputCls} ${err(`skill${i}.name`) ? "border-danger" : ""}`} />
                  </Field>
                  <Field label="Certificate Number">
                    <input value={g(row,"number")} onChange={rowSet(setSkills, i, "number")} className={inputCls} />
                  </Field>
                  <Field label="Date Attained">
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={g(row,"attained")} onChange={rowSet(setSkills, i, "attained")} className={`${inputCls} ${iconCls}`} />
                    </IconInput>
                  </Field>
                  <Field label="Expiry Date" hint="If applicable">
                    <IconInput icon={<Calendar />}>
                      <input type="date" value={g(row,"expiry")} onChange={rowSet(setSkills, i, "expiry")} className={`${inputCls} ${iconCls}`} />
                    </IconInput>
                  </Field>
                </>
              )}
            </Repeat>

            <Section title="Availability" icon={<Clock />}>
              <Field label="Preferred Working Hours / Availability *">
                <IconInput icon={<Clock />}>
                  <select value={f.availability} onChange={set("availability")} className={`${inputCls} ${iconCls}`}>
                    {availabilityOptions.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </IconInput>
              </Field>
              <Field label="How did you hear about us? *" error={err("howHeard")}>
                <select value={f.howHeard} onChange={set("howHeard")} className={`${inputCls} ${err("howHeard") ? "border-danger" : ""}`}>
                  <option value="">Select an option…</option>
                  {HOW_HEARD_OPTIONS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              {f.howHeard === "Sub-contract" && (
                <Field
                  label="Sub-contract company name *"
                  error={err("subcontractCompany")}
                  hint="The company that is subcontracting you to work with us"
                >
                  <input
                    value={f.subcontractCompany}
                    onChange={set("subcontractCompany")}
                    className={`${inputCls} ${err("subcontractCompany") ? "border-danger" : ""}`}
                    placeholder="e.g. ABC Security Ltd"
                  />
                </Field>
              )}
            </Section>
          </>
        )}

        {step === 4 && (
          <>
            <Summary
              title="Personal Details"
              items={[
                ["Position applied for", f.appliedFor],
                ["Title", f.title],
                ["Surname", f.surname],
                ["Forename", f.forename],
                ["Date of Birth", f.dob],
                ["Surname at Birth", f.birthSurname],
                ["Date of Name Change", f.nameChangeDate],
              ]}
            />
            <Summary title="Contact Information" items={[["Mobile", f.mobile], ["Email", f.email]]} />
            <Summary
              title="Current Address"
              items={[
                ["Address", [f.addr1, f.addr2, f.addr3].filter(Boolean).join(", ")],
                ["Town", f.town],
                ["Postcode", f.postcode],
                ["Country", f.country],
                ["At address from", f.addressFrom],
              ]}
            />
            {prevAddresses.map((a, i) => (
              <Summary
                key={i}
                title={`Previous Address ${i + 1}`}
                items={[
                  ["Address", [g(a,"line1"), g(a,"line2"), g(a,"line3")].filter(Boolean).join(", ")],
                  ["Town", g(a,"town")],
                  ["Postcode", g(a,"postcode")],
                  ["Country", g(a,"country")],
                  ["From", g(a,"from")],
                  ["To", g(a,"to")],
                ]}
              />
            ))}
            <Summary
              title="Nationality"
              items={[
                ["Place of Birth", f.birthPlace],
                ["Nationality", f.nationality],
                ["Permitted to work in UK", f.rtw],
              ]}
            />
            <Summary
              title="Next of Kin / Emergency Contact"
              items={[
                ["Name", `${f.kinForename} ${f.kinSurname}`.trim()],
                ["Phone", f.kinPhone],
                ["Address", [f.kinAddr1, f.kinAddr2, f.kinAddr3, f.kinTown, f.kinPostcode, f.kinCountry].filter(Boolean).join(", ")],
              ]}
            />
            <Summary
              title="Documents & Eligibility"
              items={[
                ["N.I Number", f.ni],
                ["eVisa", f.eVisa],
                ["Profile Photo", f.photo],
                ["Proof of Address", f.proofAddress],
                ["Passport type", f.passportType],
                ["Passport Country", f.passportCountry],
                ["Passport Number", f.passportNumber],
                ["Passport Issue Date", f.passportIssueDate],
                ["Passport Expiry", f.passportExpiry],
                ["Passport Document", f.passportDoc],
                ["CV / 5-year address history", f.cv],
                ["UKVI share code", f.shareCode],
                ["Permitted to work in UK", f.hasVisa],
                ["Visa Type", f.visaType],
                ["Visa Issue Date", f.visaIssueDate],
                ["Visa Expiry", f.visaExpiry],
                ["Right-to-work share code", f.rtwShareCode],
                ["SIA Badge Number", f.siaBadgeNumber],
                ["SIA Badge Expiry", f.siaBadgeExpiry],
                ["SIA Badge Front", f.siaDocFront],
                ["SIA Badge Back", f.siaDocBack],
                ["Bank Name", f.bankName],
                ["Account Holder", f.accountHolder],
                ["Sort Code", f.sortCode],
                ["Account Number", f.accountNumber],
                ["Medical conditions", f.medical],
                ["Dietary / accessibility", f.dietary],
              ]}
            />
            <Summary
              title="Work History"
              items={[
                ["Worked here before", f.workedBefore],
                ["From", f.beforeFrom],
                ["To", f.beforeTo],
                ["Reason for leaving", f.beforeReason],
              ]}
            />
            {employers.map((e, i) => (
              <Summary
                key={i}
                title={`Employment Record ${i + 1}`}
                items={[
                  ["Employer", g(e,"name")],
                  ["Role", g(e,"role")],
                  ["Address", [g(e,"address"), g(e,"town"), g(e,"postcode")].filter(Boolean).join(", ")],
                  ["Phone", g(e,"phone")],
                  ["Email", g(e,"email")],
                  ["From", g(e,"from")],
                  ["To", g(e,"to")],
                  ["Reason for leaving", g(e,"reason")],
                ]}
              />
            ))}
            {referees.map((r, i) => (
              <Summary
                key={i}
                title={`Character Referee ${i + 1}`}
                items={[
                  ["Phone", g(r,"phone")],
                  ["Email", g(r,"email")],
                  ["Address", g(r,"address")],
                  ["Years known", g(r,"years")],
                  ["Relationship", g(r,"relationship")],
                ]}
              />
            ))}
            {skills.map((s, i) => (
              <Summary
                key={i}
                title={`Qualification ${i + 1}`}
                items={[
                  ["Name", g(s,"name")],
                  ["Certificate No", g(s,"number")],
                  ["Date Attained", g(s,"attained")],
                  ["Expiry", g(s,"expiry")],
                ]}
              />
            ))}
            <Summary
              title="Skills & Availability"
              items={[
                ["Availability", f.availability],
                ["How did you hear about us", f.howHeard],
                ...(f.howHeard === "Sub-contract" ? [["Sub-contract company", f.subcontractCompany] as [string, string]] : []),
              ]}
            />

            <label className={`mt-6 flex items-start gap-3 rounded-xl border p-4 text-sm ${err("confirmed") ? "border-danger" : "border-border"}`}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  setErrors((s) => {
                    if (!s["confirmed"]) return s;
                    const { confirmed: _d, ...rest } = s;
                    return rest;
                  });
                }}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                I confirm the information provided is accurate to the best of my knowledge
                <Req />
              </span>
            </label>
            {err("confirmed") && <p className="mt-1 text-xs font-medium text-danger">{err("confirmed")}</p>}

            <label className={`mt-3 flex items-start gap-3 rounded-xl border p-4 text-sm ${err("gdprConsent") ? "border-danger" : "border-border"}`}>
              <input
                type="checkbox"
                checked={f.gdprConsent === "Yes"}
                onChange={(e) => {
                  setF((s) => ({ ...s, gdprConsent: e.target.checked ? "Yes" : "No" }));
                  setErrors((s) => {
                    if (!s["gdprConsent"]) return s;
                    const { gdprConsent: _d, ...rest } = s;
                    return rest;
                  });
                }}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                I consent to WorkHR storing and processing my personal data in accordance with the Privacy Policy and UK GDPR
                <Req />
              </span>
            </label>
            {err("gdprConsent") && <p className="mt-1 text-xs font-medium text-danger">{err("gdprConsent")}</p>}
            {err("submit") && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{err("submit")}</p>}
          </>
        )}
      </Card>

      {/* step controls */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card px-5 py-3 md:static md:mt-4 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <GhostButton disabled={step === 0} onClick={() => goTo(Math.max(0, step - 1))} className="flex-1 md:flex-none">
          <ArrowLeft className="size-4" /> Previous
        </GhostButton>
        {step < 4 ? (
          <PrimaryButton onClick={next} className="flex-1 md:ml-auto md:flex-none">
            Next <ArrowRight className="size-4" />
          </PrimaryButton>
        ) : (
          <PrimaryButton disabled={submitting} onClick={submit} className="flex-1 md:ml-auto md:flex-none">
            {submitting ? 'Submitting...' : 'Submit application'}
          </PrimaryButton>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, step, maxStep, onStep }: { children: React.ReactNode; step: number; maxStep: number; onStep: (n: number) => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <img src="/site-logo.png" alt="Sinha Security Services Limited" className="h-10 w-auto" />
          <Link to="/" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 max-md:pb-28">
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          {/* side progress panel */}
          <aside className="hidden lg:block">
            <div className="sticky top-8 rounded-2xl border border-border bg-card p-5">
              <h1 className="text-lg font-bold tracking-tight">Worker Registration</h1>
              <p className="mt-1 text-xs text-muted-foreground">Complete all 5 steps to submit your application.</p>
              <ol className="mt-6 space-y-1">
                {steps.map((s, i) => {
                  const Icon = s.icon;
                  const state = i < step ? "done" : i === step ? "current" : "todo";
                  const clickable = i <= maxStep;
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && onStep(i)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                          state === "current"
                            ? "bg-primary-soft font-semibold text-primary"
                            : state === "done"
                              ? "text-foreground hover:bg-secondary"
                              : "text-muted-foreground"
                        } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                            state === "done"
                              ? "border-success bg-success text-success-foreground"
                              : state === "current"
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card"
                          }`}
                        >
                          {state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                        </span>
                        <span className="flex-1">
                          {i + 1}. {s.name}
                        </span>
                        {state === "current" && <CircleDashed className="size-3.5 animate-pulse" />}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-6 border-t border-border pt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.max(step * 25, 5)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{step * 25}% complete</p>
              </div>
            </div>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
    </div>
  );
}
