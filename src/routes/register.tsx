import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, CheckCircle2, ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Card, Field, PrimaryButton, GhostButton, inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";

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

const VACANCY = "Site Operative";
const titles = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const availabilityOptions = ["Full-time", "Part-time", "Weekends only", "Flexible"];

type Row = Record<string, string>;
const g = (r: Row, k: string) => r[k] ?? "";

const blankPrevAddress: Row = { line1: "", line2: "", line3: "", town: "", county: "", postcode: "", country: "", from: "", to: "" };
const blankEmployer: Row = { name: "", address: "", town: "", postcode: "", phone: "", email: "", role: "", from: "", to: "", reason: "" };
const blankReferee: Row = { name: "", phone: "", email: "", address: "", years: "", relationship: "" };
const blankSkill: Row = { name: "", attained: "", expiry: "", number: "" };

const steps = ["Personal Details", "Documents & Eligibility", "Work History", "Skills & Availability", "Review & Submit"];

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: number }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="mb-3 text-sm font-semibold tracking-tight text-primary">{title}</h3>
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
}: {
  title: string;
  rows: Row[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  children: (row: Row, i: number) => React.ReactNode;
  min?: number;
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-primary">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-secondary"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      <div className="grid gap-4">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">None added.</p>}
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-border p-4">
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

function RegisterPage() {
  const { submitApplication, locations, settings, loading } = useApi();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [f, setF] = useState({
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
    county: "",
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
    kinCounty: "",
    kinPostcode: "",
    kinCountry: "United Kingdom",
    photo: "",
    idFront: "",
    idBack: "",
    proofAddress: "",
    hasVisa: "No",
    visaType: "",
    visaExpiry: "",
    bankName: "",
    accountHolder: "",
    sortAccount: "",
    medical: "",
    dietary: "",
    workedBefore: "No",
    beforeFrom: "",
    beforeTo: "",
    beforeReason: "",
    availability: availabilityOptions[0]!,
    rate: String(settings?.hourlyRate || 0),
  });
  const [prevAddresses, setPrevAddresses] = useState<Row[]>([]);
  const [employers, setEmployers] = useState<Row[]>([{ ...blankEmployer }]);
  const [referees, setReferees] = useState<Row[]>([{ ...blankReferee }]);
  const [skills, setSkills] = useState<Row[]>([]);
  const [prefLocations, setPrefLocations] = useState<string[]>([]);
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [fileObjects, setFileObjects] = useState<Record<string, File>>({});

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setFile = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setF((s) => ({ ...s, [k]: file?.name ?? "" }));
    if (!file) {
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
    const reader = new FileReader();
    reader.onload = () => setDocUrls((s) => ({ ...s, [k as string]: String(reader.result) }));
    reader.readAsDataURL(file);
    // Store the actual file object for FormData upload
    setFileObjects((s) => ({ ...s, [k as string]: file }));
  };
  const rowSet = (
    setter: React.Dispatch<React.SetStateAction<Row[]>>,
    i: number,
    key: string,
  ) => (e: { target: { value: string } }) =>
    setter((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: e.target.value } : r)));

  const pct = step * 25;

  const submit = async () => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      
      // Add basic fields
      formData.append('title', f.title);
      formData.append('surname', f.surname);
      formData.append('forename', f.forename);
      formData.append('dob', f.dob);
      formData.append('birthSurname', f.birthSurname);
      formData.append('nameChangeDate', f.nameChangeDate);
      formData.append('mobile', f.mobile);
      formData.append('email', f.email);
      formData.append('addr1', f.addr1);
      formData.append('addr2', f.addr2);
      formData.append('addr3', f.addr3);
      formData.append('town', f.town);
      formData.append('county', f.county);
      formData.append('postcode', f.postcode);
      formData.append('country', f.country);
      formData.append('addressFrom', f.addressFrom);
      formData.append('birthPlace', f.birthPlace);
      formData.append('nationality', f.nationality);
      formData.append('ni', f.ni);
      formData.append('rtw', f.rtw);
      formData.append('kinForename', f.kinForename);
      formData.append('kinSurname', f.kinSurname);
      formData.append('kinPhone', f.kinPhone);
      formData.append('kinAddr1', f.kinAddr1);
      formData.append('kinAddr2', f.kinAddr2);
      formData.append('kinAddr3', f.kinAddr3);
      formData.append('kinTown', f.kinTown);
      formData.append('kinCounty', f.kinCounty);
      formData.append('kinPostcode', f.kinPostcode);
      formData.append('kinCountry', f.kinCountry);
      formData.append('hasVisa', f.hasVisa);
      formData.append('visaType', f.visaType);
      formData.append('visaExpiry', f.visaExpiry);
      formData.append('bankName', f.bankName);
      formData.append('accountHolder', f.accountHolder);
      formData.append('sortAccount', f.sortAccount);
      formData.append('medical', f.medical);
      formData.append('dietary', f.dietary);
      formData.append('workedBefore', f.workedBefore);
      formData.append('beforeFrom', f.beforeFrom);
      formData.append('beforeTo', f.beforeTo);
      formData.append('beforeReason', f.beforeReason);
      formData.append('availability', f.availability);
      formData.append('rate', String(f.rate));
      
      // Add file uploads with actual file objects
      if (fileObjects.photo) formData.append('photo', fileObjects.photo);
      if (fileObjects.idFront) formData.append('idFront', fileObjects.idFront);
      if (fileObjects.idBack) formData.append('idBack', fileObjects.idBack);
      if (fileObjects.proofAddress) formData.append('proofAddress', fileObjects.proofAddress);
      
      // Add JSON arrays
      formData.append('prevAddresses', JSON.stringify(prevAddresses));
      formData.append('employers', JSON.stringify(employers));
      formData.append('referees', JSON.stringify(referees));
      formData.append('skills', JSON.stringify(skills));
      formData.append('prefLocations', JSON.stringify(prefLocations));

      const response = await submitApplication(formData);
      setDone(response.id);
    } catch (error) {
      console.error('Submission error:', error);
      alert('Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
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

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">Worker Registration</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Step {step + 1} of 5 — {steps[step]}
      </p>

      <div className="mt-4 mb-4">
        <div className="h-7 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="flex h-full items-center justify-end rounded-full bg-primary pr-3 text-xs font-semibold text-primary-foreground transition-all duration-300"
            style={{ width: `${Math.max(pct, 12)}%` }}
          >
            Application Form {pct}% Complete
          </div>
        </div>
      </div>

      <Card className="pb-24 md:pb-5">
        {step === 0 && (
          <>
            <Field label="Job / Position applied for">
              <input readOnly value={VACANCY} className={`${inputCls} bg-secondary text-muted-foreground`} />
            </Field>

            <Section title="Personal Details">
              <Field label="Title">
                <select value={f.title} onChange={set("title")} className={inputCls}>
                  {titles.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Surname *">
                <input value={f.surname} onChange={set("surname")} className={inputCls} />
              </Field>
              <Field label="Forename *">
                <input value={f.forename} onChange={set("forename")} className={inputCls} />
              </Field>
              <Field label="Date of Birth *">
                <input type="date" value={f.dob} onChange={set("dob")} className={inputCls} />
              </Field>
              <Field label="Surname at Birth (if different)">
                <input value={f.birthSurname} onChange={set("birthSurname")} className={inputCls} />
              </Field>
              <Field label="Date of Name Change (if applicable)">
                <input type="date" value={f.nameChangeDate} onChange={set("nameChangeDate")} className={inputCls} />
              </Field>
            </Section>

            <Section title="Contact Information">
              <Field label="Mobile *">
                <input value={f.mobile} onChange={set("mobile")} className={inputCls} placeholder="+44 7700 900000" />
              </Field>
              <Field label="Email *">
                <input type="email" value={f.email} onChange={set("email")} className={inputCls} />
              </Field>
            </Section>

            <Section title="Current Address">
              <Field label="Address Line 1 *" className="sm:col-span-2">
                <input value={f.addr1} onChange={set("addr1")} className={inputCls} />
              </Field>
              <Field label="Address Line 2">
                <input value={f.addr2} onChange={set("addr2")} className={inputCls} />
              </Field>
              <Field label="Address Line 3">
                <input value={f.addr3} onChange={set("addr3")} className={inputCls} />
              </Field>
              <Field label="Town *">
                <input value={f.town} onChange={set("town")} className={inputCls} />
              </Field>
              <Field label="County *">
                <input value={f.county} onChange={set("county")} className={inputCls} />
              </Field>
              <Field label="Postcode *">
                <input value={f.postcode} onChange={set("postcode")} className={inputCls} />
              </Field>
              <Field label="Country *">
                <input value={f.country} onChange={set("country")} className={inputCls} />
              </Field>
              <Field label="At Current Address From *">
                <input type="date" value={f.addressFrom} onChange={set("addressFrom")} className={inputCls} />
              </Field>
            </Section>

            <Repeat
              title="Previous Address"
              rows={prevAddresses}
              onAdd={() => setPrevAddresses((r) => [...r, { ...blankPrevAddress }])}
              onRemove={(i) => setPrevAddresses((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Address Line 1" className="sm:col-span-2">
                    <input value={g(row,"line1")} onChange={rowSet(setPrevAddresses, i, "line1")} className={inputCls} />
                  </Field>
                  <Field label="Address Line 2">
                    <input value={g(row,"line2")} onChange={rowSet(setPrevAddresses, i, "line2")} className={inputCls} />
                  </Field>
                  <Field label="Address Line 3">
                    <input value={g(row,"line3")} onChange={rowSet(setPrevAddresses, i, "line3")} className={inputCls} />
                  </Field>
                  <Field label="Town">
                    <input value={g(row,"town")} onChange={rowSet(setPrevAddresses, i, "town")} className={inputCls} />
                  </Field>
                  <Field label="County">
                    <input value={g(row,"county")} onChange={rowSet(setPrevAddresses, i, "county")} className={inputCls} />
                  </Field>
                  <Field label="Postcode">
                    <input value={g(row,"postcode")} onChange={rowSet(setPrevAddresses, i, "postcode")} className={inputCls} />
                  </Field>
                  <Field label="Country">
                    <input value={g(row,"country")} onChange={rowSet(setPrevAddresses, i, "country")} className={inputCls} />
                  </Field>
                  <Field label="At Address From">
                    <input type="date" value={g(row,"from")} onChange={rowSet(setPrevAddresses, i, "from")} className={inputCls} />
                  </Field>
                  <Field label="At Address To">
                    <input type="date" value={g(row,"to")} onChange={rowSet(setPrevAddresses, i, "to")} className={inputCls} />
                  </Field>
                </>
              )}
            </Repeat>

            <Section title="Nationality">
              <Field label="Town / Place of Birth *">
                <input value={f.birthPlace} onChange={set("birthPlace")} className={inputCls} />
              </Field>
              <Field label="Nationality *">
                <input value={f.nationality} onChange={set("nationality")} className={inputCls} />
              </Field>
              <Field label="National Insurance No *">
                <input value={f.ni} onChange={set("ni")} className={inputCls} placeholder="QQ 12 34 56 C" />
              </Field>
              <Field label="Are you permitted to work in the UK? *">
                <select value={f.rtw} onChange={set("rtw")} className={inputCls}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </Field>
            </Section>

            <Section title="Next of Kin / Emergency Contact">
              <Field label="Forename *">
                <input value={f.kinForename} onChange={set("kinForename")} className={inputCls} />
              </Field>
              <Field label="Surname *">
                <input value={f.kinSurname} onChange={set("kinSurname")} className={inputCls} />
              </Field>
              <Field label="Phone *">
                <input value={f.kinPhone} onChange={set("kinPhone")} className={inputCls} />
              </Field>
              <Field label="Address Line 1 *">
                <input value={f.kinAddr1} onChange={set("kinAddr1")} className={inputCls} />
              </Field>
              <Field label="Address Line 2">
                <input value={f.kinAddr2} onChange={set("kinAddr2")} className={inputCls} />
              </Field>
              <Field label="Address Line 3">
                <input value={f.kinAddr3} onChange={set("kinAddr3")} className={inputCls} />
              </Field>
              <Field label="Town *">
                <input value={f.kinTown} onChange={set("kinTown")} className={inputCls} />
              </Field>
              <Field label="County *">
                <input value={f.kinCounty} onChange={set("kinCounty")} className={inputCls} />
              </Field>
              <Field label="Postcode *">
                <input value={f.kinPostcode} onChange={set("kinPostcode")} className={inputCls} />
              </Field>
              <Field label="Country *">
                <input value={f.kinCountry} onChange={set("kinCountry")} className={inputCls} />
              </Field>
            </Section>
          </>
        )}

        {step === 1 && (
          <>
            <Section title="Uploads">
              <Field label="Profile Photo *" hint={f.photo || undefined}>
                <input type="file" accept="image/*" onChange={setFile("photo")} className={`${inputCls} py-2`} />
              </Field>
              <Field label="Proof of Address (optional)" hint={f.proofAddress || undefined}>
                <input type="file" onChange={setFile("proofAddress")} className={`${inputCls} py-2`} />
              </Field>
              <Field label="NID / ID Document — Front *" hint={f.idFront || undefined}>
                <input type="file" onChange={setFile("idFront")} className={`${inputCls} py-2`} />
              </Field>
              <Field label="NID / ID Document — Back" hint={f.idBack || undefined}>
                <input type="file" onChange={setFile("idBack")} className={`${inputCls} py-2`} />
              </Field>
            </Section>

            <Section title="Right to Work">
              <Field label="Do you hold any work permit / visa?">
                <select value={f.hasVisa} onChange={set("hasVisa")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              <Field label="Visa Type">
                <input value={f.visaType} onChange={set("visaType")} className={inputCls} />
              </Field>
              <Field label="Visa Expiry Date">
                <input type="date" value={f.visaExpiry} onChange={set("visaExpiry")} className={inputCls} />
              </Field>
            </Section>

            <Section title="Bank Details (for payroll)">
              <Field label="Bank Name">
                <input value={f.bankName} onChange={set("bankName")} className={inputCls} />
              </Field>
              <Field label="Account Holder Name">
                <input value={f.accountHolder} onChange={set("accountHolder")} className={inputCls} />
              </Field>
              <Field label="Sort Code / Account Number" className="sm:col-span-2">
                <input value={f.sortAccount} onChange={set("sortAccount")} className={inputCls} placeholder="00-00-00 / 12345678" />
              </Field>
            </Section>

            <Section title="Emergency / Health Info (optional)">
              <Field label="Any medical conditions we should be aware of" className="sm:col-span-2">
                <input value={f.medical} onChange={set("medical")} className={inputCls} />
              </Field>
              <Field label="Any dietary / accessibility needs" className="sm:col-span-2">
                <input value={f.dietary} onChange={set("dietary")} className={inputCls} />
              </Field>
            </Section>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="Previous Employment With Us">
              <Field label="Have you worked for this company before?">
                <select value={f.workedBefore} onChange={set("workedBefore")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              <Field label="Reason for leaving">
                <input value={f.beforeReason} onChange={set("beforeReason")} className={inputCls} />
              </Field>
              <Field label="From">
                <input type="date" value={f.beforeFrom} onChange={set("beforeFrom")} className={inputCls} />
              </Field>
              <Field label="To">
                <input type="date" value={f.beforeTo} onChange={set("beforeTo")} className={inputCls} />
              </Field>
            </Section>

            <Repeat
              title="Employment Record"
              rows={employers}
              onAdd={() => setEmployers((r) => [...r, { ...blankEmployer }])}
              onRemove={(i) => setEmployers((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Employer / Organisation Name *">
                    <input value={g(row,"name")} onChange={rowSet(setEmployers, i, "name")} className={inputCls} />
                  </Field>
                  <Field label="Role / Position *">
                    <input value={g(row,"role")} onChange={rowSet(setEmployers, i, "role")} className={inputCls} />
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
                    <input value={g(row,"phone")} onChange={rowSet(setEmployers, i, "phone")} className={inputCls} />
                  </Field>
                  <Field label="Email">
                    <input value={g(row,"email")} onChange={rowSet(setEmployers, i, "email")} className={inputCls} />
                  </Field>
                  <Field label="Reason for Leaving">
                    <input value={g(row,"reason")} onChange={rowSet(setEmployers, i, "reason")} className={inputCls} />
                  </Field>
                  <Field label="From *">
                    <input type="date" value={g(row,"from")} onChange={rowSet(setEmployers, i, "from")} className={inputCls} />
                  </Field>
                  <Field label="To *">
                    <input type="date" value={g(row,"to")} onChange={rowSet(setEmployers, i, "to")} className={inputCls} />
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
                  <Field label="Referee Name *">
                    <input value={g(row,"name")} onChange={rowSet(setReferees, i, "name")} className={inputCls} />
                  </Field>
                  <Field label="Referee Phone *">
                    <input value={g(row,"phone")} onChange={rowSet(setReferees, i, "phone")} className={inputCls} />
                  </Field>
                  <Field label="Referee Email *">
                    <input value={g(row,"email")} onChange={rowSet(setReferees, i, "email")} className={inputCls} />
                  </Field>
                  <Field label="Referee Address">
                    <input value={g(row,"address")} onChange={rowSet(setReferees, i, "address")} className={inputCls} />
                  </Field>
                  <Field label="How many years known *">
                    <input value={g(row,"years")} onChange={rowSet(setReferees, i, "years")} className={inputCls} />
                  </Field>
                  <Field label="Relationship to you *">
                    <input value={g(row,"relationship")} onChange={rowSet(setReferees, i, "relationship")} className={inputCls} />
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
              rows={skills}
              onAdd={() => setSkills((r) => [...r, { ...blankSkill }])}
              onRemove={(i) => setSkills((r) => r.filter((_, idx) => idx !== i))}
            >
              {(row, i) => (
                <>
                  <Field label="Qualification / Certificate Name">
                    <input value={g(row,"name")} onChange={rowSet(setSkills, i, "name")} className={inputCls} />
                  </Field>
                  <Field label="Certificate Number">
                    <input value={g(row,"number")} onChange={rowSet(setSkills, i, "number")} className={inputCls} />
                  </Field>
                  <Field label="Date Attained">
                    <input type="date" value={g(row,"attained")} onChange={rowSet(setSkills, i, "attained")} className={inputCls} />
                  </Field>
                  <Field label="Expiry Date (if applicable)">
                    <input type="date" value={g(row,"expiry")} onChange={rowSet(setSkills, i, "expiry")} className={inputCls} />
                  </Field>
                </>
              )}
            </Repeat>

            <Section title="Availability">
              <div className="sm:col-span-2">
                <span className="text-sm font-medium">Preferred Work Location(s)</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(locations || []).map((l) => {
                    const on = prefLocations.includes(l.name);
                    return (
                      <button
                        type="button"
                        key={l.id}
                        onClick={() =>
                          setPrefLocations((s) => (on ? s.filter((x) => x !== l.name) : [...s, l.name]))
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                        }`}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="Preferred Working Hours / Availability">
                <select value={f.availability} onChange={set("availability")} className={inputCls}>
                  {availabilityOptions.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <Field label="Expected Hourly Rate (£)">
                <input type="number" step="0.25" min="0" value={f.rate} onChange={set("rate")} className={inputCls} />
              </Field>
            </Section>
          </>
        )}

        {step === 4 && (
          <>
            <Summary
              title="Personal Details"
              items={[
                ["Position applied for", VACANCY],
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
                ["County", f.county],
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
                  ["County", g(a,"county")],
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
                ["National Insurance No", f.ni],
                ["Permitted to work in UK", f.rtw],
              ]}
            />
            <Summary
              title="Next of Kin / Emergency Contact"
              items={[
                ["Name", `${f.kinForename} ${f.kinSurname}`.trim()],
                ["Phone", f.kinPhone],
                ["Address", [f.kinAddr1, f.kinAddr2, f.kinAddr3, f.kinTown, f.kinCounty, f.kinPostcode, f.kinCountry].filter(Boolean).join(", ")],
              ]}
            />
            <Summary
              title="Documents & Eligibility"
              items={[
                ["Profile Photo", f.photo],
                ["ID Front", f.idFront],
                ["ID Back", f.idBack],
                ["Proof of Address", f.proofAddress],
                ["Work permit / visa", f.hasVisa],
                ["Visa Type", f.visaType],
                ["Visa Expiry", f.visaExpiry],
                ["Bank Name", f.bankName],
                ["Account Holder", f.accountHolder],
                ["Sort Code / Account", f.sortAccount],
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
                  ["Name", g(r,"name")],
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
                ["Preferred locations", prefLocations.join(", ")],
                ["Availability", f.availability],
                ["Expected hourly rate", f.rate ? `£${f.rate}` : ""],
              ]}
            />

            <label className="mt-6 flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                I confirm the information provided is accurate to the best of my knowledge
                <Req />
              </span>
            </label>
          </>
        )}
      </Card>

      {/* step controls */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card px-5 py-3 md:static md:mt-4 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <GhostButton disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="flex-1 md:flex-none">
          <ArrowLeft className="size-4" /> Previous
        </GhostButton>
        {step < 4 ? (
          <PrimaryButton onClick={() => setStep((s) => Math.min(4, s + 1))} className="flex-1 md:ml-auto md:flex-none">
            Next <ArrowRight className="size-4" />
          </PrimaryButton>
        ) : (
          <PrimaryButton disabled={!confirmed || submitting} onClick={submit} className="flex-1 md:ml-auto md:flex-none">
            {submitting ? 'Submitting...' : 'Submit application'}
          </PrimaryButton>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">WorkHR</span>
          <Link to="/" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 max-md:pb-28">{children}</main>
    </div>
  );
}
