import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Users, MapPin, LayoutDashboard, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { avatarUrl } from "@/lib/mock-data";

type Result = {
  key: string;
  label: string;
  sub: string;
  kind: "worker" | "location" | "page" | "document";
  img?: string;
  go: () => void;
};

const pages = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/workers", label: "Worker Directory" },
  { to: "/admin/attendance", label: "Attendance" },
  { to: "/admin/payrolls", label: "Payrolls" },
  { to: "/admin/approvals", label: "Registration Approvals" },
  { to: "/admin/locations", label: "Locations" },
  { to: "/admin/notifications", label: "Notifications" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/settings", label: "Settings" },
  { to: "/admin/help", label: "Help & Center" },
];

export function GlobalSearch({
  className,
  autoFocus,
  onDone,
}: {
  className?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const { workers, locations, session } = useApi();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);

  // Load documents once for search (admin context only)
  useEffect(() => {
    if (session?.role !== "admin") return;
    apiClient.get<{ id: string; name: string }[]>("/api/documents")
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [session?.role]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: Result[] = [];
    for (const w of workers) {
      const searchableFields = [w.id, w.name, w.phone, w.email];
      if (searchableFields.some((value) => (value ?? "").toLowerCase().includes(term))) {
        out.push({
          key: `w-${w.id}`,
          label: w.name,
          sub: [w.id, w.phone, w.email].filter(Boolean).join(" · "),
          kind: "worker",
          img: avatarUrl(w.name),
          go: () => navigate({ to: "/admin/workers/$id", params: { id: w.id } }),
        });
      }
    }
    for (const l of locations) {
      if (l.name.toLowerCase().includes(term))
        out.push({
          key: `l-${l.id}`,
          label: l.name,
          sub: "Location",
          kind: "location",
          go: () => navigate({ to: "/admin/locations" }),
        });
    }
    for (const d of docs) {
      if (d.name.toLowerCase().includes(term))
        out.push({
          key: `d-${d.id}`,
          label: d.name,
          sub: "Document",
          kind: "document",
          go: () => navigate({ to: "/admin/documents" }),
        });
    }
    for (const p of pages) {
      if (p.label.toLowerCase().includes(term))
        out.push({
          key: `p-${p.to}`,
          label: p.label,
          sub: "Page",
          kind: "page",
          go: () => navigate({ to: p.to }),
        });
    }
    return out.slice(0, 10);
  }, [q, workers, locations, docs, navigate]);

  const groups: [string, string][] = [
    ["worker", "Workers"],
    ["location", "Locations"],
    ["document", "Documents"],
    ["page", "Pages"],
  ];

  const pick = (r: Result) => {
    r.go();
    setQ("");
    setOpen(false);
    onDone?.();
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
      <input
        autoFocus={autoFocus}
        value={q}
        placeholder="Search anything..."
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) pick(results[0]);
          if (e.key === "Escape") {
            setOpen(false);
            onDone?.();
          }
        }}
        className="h-10 w-full rounded-lg border border-border bg-background pl-9 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
      />

      {open && q.trim() && (
        <div className="absolute top-12 right-0 left-0 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No matches for “{q}”</p>
          ) : (
            groups.map(([kind, label]) => {
              const items = results.filter((r) => r.kind === kind);
              if (!items.length) return null;
              return (
                <div key={kind}>
                  <p className="bg-secondary/50 px-3 py-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</p>
                  {items.map((r) => (
                    <button
                      key={r.key}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (blurTimer.current) clearTimeout(blurTimer.current);
                        pick(r);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-secondary"
                    >
                      {r.img ? (
                        <img src={r.img} alt="" className="size-7 shrink-0 rounded-full bg-secondary" />
                      ) : (
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                          {r.kind === "location" ? (
                            <MapPin className="size-3.5" />
                          ) : r.kind === "page" ? (
                            <LayoutDashboard className="size-3.5" />
                          ) : r.kind === "document" ? (
                            <FileText className="size-3.5" />
                          ) : (
                            <Users className="size-3.5" />
                          )}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
