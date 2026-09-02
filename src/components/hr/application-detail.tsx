import type { ReactNode } from "react";
import { FileImage, ExternalLink } from "lucide-react";
import { avatarUrl, type Application } from "@/lib/mock-data";
import { StatusBadge } from "@/components/hr/bits";
import { fmtDate } from "@/lib/hr-utils";

type Row = Record<string, string>;
const g = (r: Row | undefined, k: string) => (r?.[k] ?? "").toString();

const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 text-sm font-semibold tracking-tight text-primary">{title}</h3>
      {children}
    </section>
  );
}

function SummaryList({ items }: { items: [string, unknown][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 rounded-xl border border-border p-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-sm">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium break-words">{val(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Repeat({
  title,
  rows,
  fields,
  emptyLabel,
}: {
  title: string;
  rows: Row[];
  fields: [string, string][];
  emptyLabel: string;
}) {
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-normal text-muted-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-border p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {title} #{i + 1}
              </p>
              <SummaryList items={fields.map(([label, key]) => [label, g(r, key)])} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Doc({ label, name, url }: { label: string; name: string; url?: string | undefined }) {
  const body = (
    <>
      <FileImage className="size-5" />
      <span className="max-w-full truncate text-xs">{name || `No ${label.toLowerCase()}`}</span>
      {url && (
        <span className="flex items-center gap-1 text-xs font-medium text-primary">
          Open <ExternalLink className="size-3" />
        </span>
      )}
    </>
  );
  const cls =
    "flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-center text-muted-foreground";
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className={`${cls} hover:bg-secondary`}>
          {body}
        </a>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </div>
  );
}

/** Read-only, grouped summary of a full 5-step application (Step 5 review layout). */
export function ApplicationDetail({ app }: { app: Application }) {
  const d = (app.details ?? {}) as Record<string, unknown>;
  const docUrls = (d["docUrls"] ?? {}) as Record<string, string>;
  const str = (k: string) => (d[k] ?? "") as string;
  const prevAddresses = asRows(d["prevAddresses"]);
  const employers = asRows(d["employers"]);
  const referees = asRows(d["referees"]);
  const skills = asRows(d["skills"]);
  const prefLocations = asStrings(d["prefLocations"]);

  // Handle both old and new field names for compatibility
  const getDetail = (key: string, fallback?: string) => str(key) || fallback || "";

  // Get full URL for uploaded files
  const getFileUrl = (path: string) => {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `http://localhost:3001${path}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <img
          src={getFileUrl(docUrls["photo"]) || avatarUrl(app.name)}
          alt={app.name}
          className="size-20 rounded-2xl bg-secondary object-cover"
        />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{app.name}</h2>
          <p className="text-sm text-muted-foreground">
            {app.appliedFor} · submitted {fmtDate(app.submitted)}
          </p>
          <div className="mt-2">
            <StatusBadge status="Pending" />
          </div>
        </div>
      </div>

      <Group title="Personal Details">
        <SummaryList
          items={[
            ["Application ID", app.id],
            ["Position applied for", app.appliedFor],
            ["Submitted", fmtDate(app.submitted)],
            ["Title", getDetail("title", "Mr")],
            ["Surname", getDetail("surname", app.name.split(" ").pop() || "")],
            ["Forename", getDetail("forename", app.name.split(" ")[0] || "")],
            ["Date of Birth", getDetail("dob", "")],
            ["Surname at Birth", getDetail("birthSurname", "")],
            ["Date of Name Change", getDetail("nameChangeDate", "")],
          ]}
        />
      </Group>

      <Group title="Contact Information">
        <SummaryList items={[["Mobile", getDetail("mobile", app.phone) || app.phone], ["Email", getDetail("email", app.email) || app.email]]} />
      </Group>

      <Group title="Current Address">
        <SummaryList
          items={[
            ["Address Line 1", getDetail("addr1", app.address) || app.address],
            ["Address Line 2", getDetail("addr2", "")],
            ["Address Line 3", getDetail("addr3", "")],
            ["Town", getDetail("town", "")],
            ["County", getDetail("county", "")],
            ["Postcode", getDetail("postcode", "")],
            ["Country", getDetail("country", "United Kingdom")],
            ["At Current Address From", getDetail("addressFrom", "")],
          ]}
        />
      </Group>

      <Group title="Previous Address(es)">
        <Repeat
          title="Previous Address"
          rows={prevAddresses}
          emptyLabel="No previous addresses provided."
          fields={[
            ["Address Line 1", "line1"],
            ["Address Line 2", "line2"],
            ["Address Line 3", "line3"],
            ["Town", "town"],
            ["County", "county"],
            ["Postcode", "postcode"],
            ["Country", "country"],
            ["At Address From", "from"],
            ["At Address To", "to"],
          ]}
        />
      </Group>

      <Group title="Nationality">
        <SummaryList
          items={[
            ["Place of Birth", getDetail("birthPlace", "")],
            ["Nationality", getDetail("nationality", "British")],
            ["National Insurance No", getDetail("ni", app.nid) || app.nid],
            ["Permitted to work in UK", getDetail("rtw", "Yes")],
          ]}
        />
      </Group>

      <Group title="Next of Kin/Emergency Contact">
        <SummaryList
          items={[
            ["Forename", getDetail("kinForename", "")],
            ["Surname", getDetail("kinSurname", "")],
            ["Phone", getDetail("kinPhone", "")],
            ["Address Line 1", getDetail("kinAddr1", "")],
            ["Address Line 2", getDetail("kinAddr2", "")],
            ["Address Line 3", getDetail("kinAddr3", "")],
            ["Town", getDetail("kinTown", "")],
            ["County", getDetail("kinCounty", "")],
            ["Postcode", getDetail("kinPostcode", "")],
            ["Country", getDetail("kinCountry", "United Kingdom")],
          ]}
        />
      </Group>

      <Group title="Documents & Eligibility">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Doc label="Profile Photo" name={getDetail("photo", "")} url={getFileUrl(docUrls["photo"])} />
          <Doc label="NID / ID Front" name={getDetail("idFront", "")} url={getFileUrl(docUrls["idFront"])} />
          <Doc label="NID / ID Back" name={getDetail("idBack", "")} url={getFileUrl(docUrls["idBack"])} />
          <Doc label="Proof of Address" name={getDetail("proofAddress", "")} url={getFileUrl(docUrls["proofAddress"])} />
        </div>
        <div className="mt-3">
          <SummaryList
            items={[
              ["Holds work permit / visa", getDetail("hasVisa", "No")],
              ["Visa Type", getDetail("visaType", "")],
              ["Visa Expiry", getDetail("visaExpiry", "")],
              ["Bank Name", getDetail("bankName", "")],
              ["Account Holder", getDetail("accountHolder", "")],
              ["Sort Code / Account Number", getDetail("sortAccount", "")],
              ["Medical conditions", getDetail("medical", "")],
              ["Dietary / accessibility needs", getDetail("dietary", "")],
            ]}
          />
        </div>
      </Group>

      <Group title="Work History">
        <SummaryList
          items={[
            ["Worked here before", getDetail("workedBefore", "No")],
            ["From", getDetail("beforeFrom", "")],
            ["To", getDetail("beforeTo", "")],
            ["Reason for leaving", getDetail("beforeReason", "")],
          ]}
        />
        <Repeat
          title="Employment Record"
          rows={employers}
          emptyLabel="No employment history provided."
          fields={[
            ["Employer", "name"],
            ["Role / Position", "role"],
            ["Address", "address"],
            ["Town", "town"],
            ["Postcode", "postcode"],
            ["Phone", "phone"],
            ["Email", "email"],
            ["From", "from"],
            ["To", "to"],
            ["Reason for Leaving", "reason"],
          ]}
        />
        <Repeat
          title="Character Referee"
          rows={referees}
          emptyLabel="No referees provided."
          fields={[
            ["Name", "name"],
            ["Phone", "phone"],
            ["Email", "email"],
            ["Address", "address"],
            ["Years Known", "years"],
            ["Relationship", "relationship"],
          ]}
        />
      </Group>

      <Group title="Skills & Availability">
        <Repeat
          title="Skills & Qualifications"
          rows={skills}
          emptyLabel="No qualifications provided."
          fields={[
            ["Qualification", "name"],
            ["Certificate Number", "number"],
            ["Date Attained", "attained"],
            ["Expiry Date", "expiry"],
          ]}
        />
        <div className="mt-3">
          <SummaryList
            items={[
              ["Preferred Locations", prefLocations.length ? prefLocations : app.location],
              ["Preferred Hours", getDetail("availability", "Full-time")],
              ["Expected Hourly Rate", `£${(Number(getDetail("rate", String(app.rate))) || app.rate).toFixed(2)} / hour`],
            ]}
          />
        </div>
      </Group>
    </div>
  );
}
