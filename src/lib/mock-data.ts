import { addDays, todayISO, toISO, money, money2 } from "./hr-utils";

export { money, money2 };

export const admin = { name: "Turja Sen", role: "HR Administrator" };

export const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=ede9fe,ddd6fe,cffafe,fef3c7`;

export type WorkerStatus = "Active" | "Expiring Soon" | "Expired" | "On Leave";

export type Worker = {
  id: string;
  name: string;
  phone: string;
  email: string;
  location: string;
  joined: string | Date; // ISO string or Date object
  expiry: string | Date; // ISO string or Date object
  onLeave?: boolean;
  role: string;
  rate: number;
  address?: string;
  nid?: string;
  passportCountry?: string;
  passportNumber?: string;
  passportExpiry?: string | Date;
  visaNumber?: string;
  visaExpiry?: string | Date;
  siaBadgeNumber?: string;
  siaBadgeExpiry?: string | Date;
  workerType?: string;
  subcontractCompany?: string;
  /** Count of BS7858 checks marked complete (0–8), from backend (Phase E) */
  complianceDone?: number;
};

/** expiry = today + daysLeft, joined = expiry - 90 days */
const seedWorker = (
  id: string,
  name: string,
  phone: string,
  email: string,
  location: string,
  role: string,
  rate: number,
  daysLeft: number,
  onLeave = false,
): Worker => {
  const expiry = addDays(todayISO(), daysLeft);
  return { id, name, phone, email, location, role, rate, expiry, joined: addDays(expiry, -90), onLeave };
};

export const seedWorkers: Worker[] = [
  seedWorker("WRK-10241", "Hazel Nutt", "+44 7700 900123", "hazel.n@mail.com", "Camden Site", "Site Operative", 14.5, 62),
  seedWorker("WRK-10242", "Simon Cyrene", "+44 7700 900456", "simon.c@mail.com", "Hackney Depot", "Forklift Driver", 16, 24),
  seedWorker("WRK-10243", "Aida Bugg", "+44 7700 900789", "aida.b@mail.com", "Stratford Yard", "Packer", 12.75, 5, true),
  seedWorker("WRK-10244", "Peg Legge", "+44 7700 900222", "peg.l@mail.com", "Camden Site", "Warehouse Assistant", 13.2, 71),
  seedWorker("WRK-10245", "Marcus Ohms", "+44 7700 900333", "marcus.o@mail.com", "Croydon Hub", "Cleaner", 11.9, -4),
  seedWorker("WRK-10246", "Nadia Karim", "+44 7700 900444", "nadia.k@mail.com", "Hackney Depot", "Team Lead", 19.5, 6),
  seedWorker("WRK-10247", "Owen Blake", "+44 7700 900555", "owen.b@mail.com", "Stratford Yard", "Site Operative", 14.5, 21),
  seedWorker("WRK-10248", "Priya Anand", "+44 7700 900666", "priya.a@mail.com", "Croydon Hub", "Quality Checker", 15.25, 84),
];

export type Application = {
  id: string;
  name: string;
  submitted: string; // ISO
  phone: string;
  email: string;
  address: string;
  nid: string;
  appliedFor: string;
  location: string;
  rate: number;
  status: "pending" | "approved" | "rejected";
  workerId?: string;
  worker_joined?: string;
  worker_expiry?: string;
  rejectedOn?: string;
  howHeard?: string;
  subcontractCompany?: string;
  workerType?: string;
  passportCountry?: string;
  passportNumber?: string;
  passportExpiry?: string | Date;
  visaNumber?: string;
  visaExpiry?: string | Date;
  siaBadgeNumber?: string;
  siaBadgeExpiry?: string | Date;
  compliance?: Compliance;
  /** Full multi-step application payload (optional, demo only). */
  details?: Record<string, unknown>;
};

/** Admin-only compliance checklist completed during application review. */
export type Compliance = {
  electronicId: boolean;
  addressHistory: boolean;
  financialChecks: boolean;
  rightToWork: boolean;
  employmentHistory5y: boolean;
  gapPeriods: boolean;
  academicQualifications: boolean;
  criminalRecords: boolean;
  criminalRecordsLevel: string;
};

export const COMPLIANCE_ITEMS: { key: keyof Omit<Compliance, "criminalRecordsLevel">; label: string }[] = [
  { key: "electronicId", label: "Electronic ID verification" },
  { key: "addressHistory", label: "Address history verification" },
  { key: "financialChecks", label: "Financial checks (UK and overseas where applicable)" },
  { key: "rightToWork", label: "Right to work" },
  { key: "employmentHistory5y", label: "5-year employment history verification" },
  { key: "gapPeriods", label: "Investigation and verification of gap periods" },
  { key: "academicQualifications", label: "Academic qualifications (if within the 5-year period)" },
  { key: "criminalRecords", label: "Criminal records check" },
];

export const CRIMINAL_CHECK_LEVELS = ["Basic", "Standard", "Enhanced"];

/* ---------------- per-worker BS7858 compliance (Phase E) ---------------- */

export type WorkerCheckStatus = "not_started" | "in_progress" | "complete";

export type WorkerComplianceCheck = {
  key: string;
  status: WorkerCheckStatus;
  completedDate: string | null;
  notes: string;
  level: string;
};

export type WorkerCompliance = {
  workerId: string;
  checks: WorkerComplianceCheck[];
  complete: number;
  total: number;
};

export const WORKER_CHECK_STATUSES: { value: WorkerCheckStatus; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "complete", label: "Complete" },
];

export const blankCompliance = (): Compliance => ({
  electronicId: false,
  addressHistory: false,
  financialChecks: false,
  rightToWork: false,
  employmentHistory5y: false,
  gapPeriods: false,
  academicQualifications: false,
  criminalRecords: false,
  criminalRecordsLevel: "",
});

export const HOW_HEARD_OPTIONS = [
  "Family",
  "Friends",
  "YouTube",
  "Social Media",
  "Facebook",
  "Search Engine",
  "Sub-contract",
  "Other",
];

const docUrl = (label: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(`${label} preview document`)}`;

const applicationDetails = ({
  title,
  surname,
  forename,
  dob,
  phone,
  email,
  addr1,
  town,
  county,
  postcode,
  birthPlace,
  nationality,
  ni,
  kinForename,
  kinSurname,
  kinPhone,
  bankName,
  accountHolder,
  sortAccount,
  workedBefore,
  rate,
  prefLocations,
}: {
  title: string;
  surname: string;
  forename: string;
  dob: string;
  phone: string;
  email: string;
  addr1: string;
  town: string;
  county: string;
  postcode: string;
  birthPlace: string;
  nationality: string;
  ni: string;
  kinForename: string;
  kinSurname: string;
  kinPhone: string;
  bankName: string;
  accountHolder: string;
  sortAccount: string;
  workedBefore: "Yes" | "No";
  rate: string;
  prefLocations: string[];
}) => ({
  title,
  surname,
  forename,
  dob,
  birthSurname: surname,
  nameChangeDate: "",
  mobile: phone,
  email,
  addr1,
  addr2: "",
  addr3: "",
  town,
  county,
  postcode,
  country: "United Kingdom",
  addressFrom: "2022-04-01",
  birthPlace,
  nationality,
  ni,
  rtw: "Yes",
  kinForename,
  kinSurname,
  kinPhone,
  kinAddr1: "18 Emergency Contact Road",
  kinAddr2: "",
  kinAddr3: "",
  kinTown: town,
  kinCounty: county,
  kinPostcode: postcode,
  kinCountry: "United Kingdom",
  photo: `${forename.toLowerCase()}-${surname.toLowerCase()}-photo.png`,
  idFront: `${forename.toLowerCase()}-${surname.toLowerCase()}-id-front.pdf`,
  idBack: `${forename.toLowerCase()}-${surname.toLowerCase()}-id-back.pdf`,
  proofAddress: `${forename.toLowerCase()}-${surname.toLowerCase()}-proof-address.pdf`,
  hasVisa: "No",
  visaType: "",
  visaExpiry: "",
  bankName,
  accountHolder,
  sortAccount,
  medical: "None declared",
  dietary: "No adjustments requested",
  workedBefore,
  beforeFrom: workedBefore === "Yes" ? "2021-02-01" : "",
  beforeTo: workedBefore === "Yes" ? "2021-11-30" : "",
  beforeReason: workedBefore === "Yes" ? "Contract completed" : "",
  availability: "Full-time",
  rate,
  prevAddresses: [
    {
      line1: "7 Previous Street",
      line2: "Flat 2",
      line3: "",
      town: "London",
      county: "Greater London",
      postcode: "E3 4AB",
      country: "United Kingdom",
      from: "2020-01-01",
      to: "2022-03-31",
    },
  ],
  employers: [
    {
      name: "Metro Workforce Ltd",
      address: "10 Dock Road",
      town: "London",
      postcode: "E16 1AA",
      phone: "+44 7700 910000",
      email: "hr@metroworkforce.example",
      role: "Warehouse Operative",
      from: "2021-01-10",
      to: "2024-04-30",
      reason: "Seeking regular site placement",
    },
  ],
  referees: [
    {
      name: `${kinForename} ${kinSurname}`,
      phone: kinPhone,
      email: `${kinForename.toLowerCase()}.${kinSurname.toLowerCase()}@mail.com`,
      address: "18 Emergency Contact Road",
      years: "5",
      relationship: "Character referee",
    },
  ],
  skills: [
    { name: "Manual Handling", attained: "2023-06-15", expiry: "2026-06-15", number: "MH-88421" },
    { name: "Health & Safety Level 2", attained: "2024-02-20", expiry: "2027-02-20", number: "HS2-44219" },
  ],
  prefLocations,
  docUrls: {
    photo: avatarUrl(`${forename} ${surname}`),
    idFront: docUrl(`${forename} ${surname} ID front`),
    idBack: docUrl(`${forename} ${surname} ID back`),
    proofAddress: docUrl(`${forename} ${surname} proof of address`),
  },
});

export const seedApplications: Application[] = [
  {
    id: "APP-3301",
    name: "Colin Sample",
    submitted: addDays(todayISO(), -6),
    phone: "+44 7700 901111",
    email: "colin.s@mail.com",
    address: "42 Fenwick Road, London E15 3QD",
    nid: "QQ 12 34 56 C",
    appliedFor: "Site Operative",
    location: "Camden Site",
    rate: 14.5,
    status: "pending" as const,
    details: applicationDetails({
      title: "Mr",
      surname: "Sample",
      forename: "Colin",
      dob: "1992-05-14",
      phone: "+44 7700 901111",
      email: "colin.s@mail.com",
      addr1: "42 Fenwick Road",
      town: "London",
      county: "Greater London",
      postcode: "E15 3QD",
      birthPlace: "Newham",
      nationality: "British",
      ni: "QQ 12 34 56 C",
      kinForename: "Mara",
      kinSurname: "Sample",
      kinPhone: "+44 7700 905101",
      bankName: "Barclays",
      accountHolder: "Colin Sample",
      sortAccount: "20-11-88 / 12345678",
      workedBefore: "No",
      rate: "14.5",
      prefLocations: ["Camden Site", "Stratford Yard"],
    }),
  },
  {
    id: "APP-3302",
    name: "Rita Book",
    submitted: addDays(todayISO(), -5),
    phone: "+44 7700 902222",
    email: "rita.b@mail.com",
    address: "17 Marlow Street, London SE1 6BQ",
    nid: "AB 11 87 20 D",
    appliedFor: "Packer",
    location: "Hackney Depot",
    rate: 12.75,
    status: "pending" as const,
    details: applicationDetails({
      title: "Ms",
      surname: "Book",
      forename: "Rita",
      dob: "1995-09-03",
      phone: "+44 7700 902222",
      email: "rita.b@mail.com",
      addr1: "17 Marlow Street",
      town: "London",
      county: "Greater London",
      postcode: "SE1 6BQ",
      birthPlace: "Southwark",
      nationality: "British",
      ni: "AB 11 87 20 D",
      kinForename: "Dina",
      kinSurname: "Book",
      kinPhone: "+44 7700 905202",
      bankName: "Lloyds",
      accountHolder: "Rita Book",
      sortAccount: "30-22-10 / 87654321",
      workedBefore: "Yes",
      rate: "12.75",
      prefLocations: ["Hackney Depot"],
    }),
  },
  {
    id: "APP-3303",
    name: "Tim Burr",
    submitted: addDays(todayISO(), -4),
    phone: "+44 7700 903333",
    email: "tim.b@mail.com",
    address: "9 Bramley Close, Croydon CR0 2LX",
    nid: "CD 77 41 00 E",
    appliedFor: "Forklift Driver",
    location: "Croydon Hub",
    rate: 16,
    status: "pending" as const,
    details: applicationDetails({
      title: "Mr",
      surname: "Burr",
      forename: "Tim",
      dob: "1989-12-21",
      phone: "+44 7700 903333",
      email: "tim.b@mail.com",
      addr1: "9 Bramley Close",
      town: "Croydon",
      county: "Surrey",
      postcode: "CR0 2LX",
      birthPlace: "Croydon",
      nationality: "British",
      ni: "CD 77 41 00 E",
      kinForename: "Leah",
      kinSurname: "Burr",
      kinPhone: "+44 7700 905303",
      bankName: "NatWest",
      accountHolder: "Tim Burr",
      sortAccount: "60-05-09 / 44332211",
      workedBefore: "No",
      rate: "16",
      prefLocations: ["Croydon Hub"],
    }),
  },
  {
    id: "APP-3304",
    name: "Sana Chowdhury",
    submitted: addDays(todayISO(), -2),
    phone: "+44 7700 904444",
    email: "sana.c@mail.com",
    address: "88 Kingsland Road, London E2 8AA",
    nid: "EF 55 20 77 F",
    appliedFor: "Quality Checker",
    location: "Stratford Yard",
    rate: 15.25,
    status: "pending" as const,
    details: applicationDetails({
      title: "Ms",
      surname: "Chowdhury",
      forename: "Sana",
      dob: "1991-07-30",
      phone: "+44 7700 904444",
      email: "sana.c@mail.com",
      addr1: "88 Kingsland Road",
      town: "London",
      county: "Greater London",
      postcode: "E2 8AA",
      birthPlace: "Tower Hamlets",
      nationality: "British",
      ni: "EF 55 20 77 F",
      kinForename: "Rafi",
      kinSurname: "Chowdhury",
      kinPhone: "+44 7700 905404",
      bankName: "HSBC",
      accountHolder: "Sana Chowdhury",
      sortAccount: "40-18-22 / 99887766",
      workedBefore: "Yes",
      rate: "15.25",
      prefLocations: ["Stratford Yard", "Hackney Depot"],
    }),
  },
];

export type Attendance = {
  id: string;
  workerId: string;
  worker: string;
  date: string; // ISO
  in: string;
  out: string;
  location: string;
  hours: number;
  source: "Self" | "Admin";
  /** Phase E: worker's actual GPS at check-in + geofence flag */
  checkInLat?: number | null;
  checkInLng?: number | null;
  locationMismatch?: boolean;
  /** Phase F: 'none' | 'match' | 'mismatch' vs today's assigned location */
  assignmentStatus?: string;
  /** Auto-detect: nearest geofenced location + distance (for unmatched check-ins) */
  nearestLocation?: string | null;
  distanceMeters?: number | null;
};

const att = (
  id: string,
  workerId: string,
  worker: string,
  back: number,
  tin: string,
  tout: string,
  location: string,
  hours: number,
  source: "Self" | "Admin",
): Attendance => ({ id, workerId, worker, date: addDays(todayISO(), -back), in: tin, out: tout, location, hours, source });

export const seedAttendance: Attendance[] = [
  att("ATT-9001", "WRK-10241", "Hazel Nutt", 1, "08:02", "17:04", "Camden Site", 9.03, "Self"),
  att("ATT-9002", "WRK-10242", "Simon Cyrene", 1, "07:55", "16:30", "Hackney Depot", 8.58, "Self"),
  att("ATT-9003", "WRK-10244", "Peg Legge", 1, "09:10", "18:00", "Camden Site", 8.83, "Admin"),
  att("ATT-9004", "WRK-10246", "Nadia Karim", 2, "08:00", "17:30", "Hackney Depot", 9.5, "Self"),
  att("ATT-9005", "WRK-10247", "Owen Blake", 2, "08:15", "16:45", "Stratford Yard", 8.5, "Admin"),
  att("ATT-9006", "WRK-10248", "Priya Anand", 2, "07:45", "16:15", "Croydon Hub", 8.5, "Self"),
  att("ATT-9007", "WRK-10243", "Aida Bugg", 3, "08:30", "17:00", "Stratford Yard", 8.5, "Self"),
  att("ATT-9008", "WRK-10241", "Hazel Nutt", 3, "08:00", "16:45", "Camden Site", 8.75, "Self"),
  att("ATT-9009", "WRK-10241", "Hazel Nutt", 4, "07:58", "17:10", "Hackney Depot", 9.2, "Self"),
  att("ATT-9010", "WRK-10242", "Simon Cyrene", 4, "08:05", "17:00", "Hackney Depot", 8.92, "Admin"),
  att("ATT-9011", "WRK-10241", "Hazel Nutt", 7, "08:20", "16:30", "Camden Site", 8.17, "Self"),
  att("ATT-9012", "WRK-10244", "Peg Legge", 8, "08:00", "17:00", "Camden Site", 9, "Self"),
  att("ATT-9013", "WRK-10246", "Nadia Karim", 9, "08:10", "17:20", "Hackney Depot", 9.17, "Self"),
  att("ATT-9014", "WRK-10248", "Priya Anand", 10, "07:50", "16:20", "Croydon Hub", 8.5, "Self"),
];

export type Payroll = {
  id: string;
  workerId: string;
  worker: string;
  from: string; // ISO
  to: string; // ISO
  hours: number;
  rate: number;
  gross: number;
  advance: number;
  tax: number;
  net: number;
  holidayHours?: number;
  holidayPay?: number;
  status: "Completed" | "Pending";
  created: string; // ISO
};

export type BankHoliday = {
  id: number;
  date: string; // ISO
  name: string;
};

const mkSeed = (
  id: string,
  workerId: string,
  worker: string,
  hours: number,
  rate: number,
  advance: number,
  status: "Completed" | "Pending",
  back: number,
): Payroll => {
  const gross = Math.round(hours * rate * 100) / 100;
  const tax = Math.round(gross * 0.32 * 100) / 100;
  return {
    id,
    workerId,
    worker,
    hours,
    rate,
    advance,
    gross,
    tax,
    net: Math.round((gross - tax - advance) * 100) / 100,
    status,
    from: addDays(todayISO(), -back - 30),
    to: addDays(todayISO(), -back),
    created: addDays(todayISO(), -back),
  };
};

export const seedPayrolls: Payroll[] = [
  mkSeed("PYRL-12024", "WRK-10241", "Hazel Nutt", 168, 14.5, 200, "Completed", 2),
  mkSeed("PYRL-12025", "WRK-10242", "Simon Cyrene", 172, 16, 100, "Completed", 2),
  mkSeed("PYRL-12026", "WRK-10243", "Aida Bugg", 140, 12.75, 350, "Pending", 3),
  mkSeed("PYRL-12027", "WRK-10244", "Peg Legge", 160, 13.2, 0, "Pending", 3),
  mkSeed("PYRL-12028", "WRK-10246", "Nadia Karim", 176, 19.5, 500, "Completed", 4),
  mkSeed("PYRL-12029", "WRK-10247", "Owen Blake", 152, 14.5, 120, "Completed", 5),
  mkSeed("PYRL-12030", "WRK-10248", "Priya Anand", 164, 15.25, 0, "Pending", 6),
];

export type LocationItem = {
  id: string;
  name: string;
  address: string;
  /** Phase E: geofence anchor — null when not configured */
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
};

export const seedLocations: LocationItem[] = [
  { id: "LOC-01", name: "Camden Site", address: "24 Camden High St, London NW1 0JH" },
  { id: "LOC-02", name: "Hackney Depot", address: "112 Morning Lane, London E9 6LH" },
  { id: "LOC-03", name: "Stratford Yard", address: "3 Angel Lane, London E15 1DF" },
  { id: "LOC-04", name: "Croydon Hub", address: "60 George St, Croydon CR0 1PB" },
];

export type Notice = {
  id: string;
  worker: string;
  workerId?: string;
  message: string;
  urgency: "critical" | "warning" | "info";
  occurred_at: string;
  /** 'contract' = probation/worker-code expiry, 'visa' = visa expiry (Phase E) */
  category?: string;
};

export const seedActivity: Notice[] = [
  { id: "N-A1", worker: "Priya Anand", message: "Documents verified and archived", urgency: "info", occurred_at: "2 days ago" },
  { id: "N-A2", worker: "Peg Legge", message: "Attendance edited by admin", urgency: "info", occurred_at: "3 days ago" },
];

export type Settings = {
  hourlyRate: number;
  overtimeMultiplier: number;
  overtimeThreshold: number;
  contractMonths: number;
  taxRate: number;
  niRate: number;
  pensionRate: number;
  maxAdvance: number;
  firstReminderDays: number;
  finalReminderDays: number;
  companyName: string;
  payrollEmail: string;
  billingMultiplier: number;
  holidayPayMultiplier: number;
};

export const seedSettings: Settings = {
  hourlyRate: 14.5,
  overtimeMultiplier: 1.5,
  overtimeThreshold: 40,
  contractMonths: 3,
  taxRate: 20,
  niRate: 12,
  pensionRate: 5,
  maxAdvance: 500,
  firstReminderDays: 30,
  finalReminderDays: 7,
  companyName: "WorkHR Staffing Ltd",
  payrollEmail: "payroll@workhr.co.uk",
  billingMultiplier: 1.45,
  holidayPayMultiplier: 2.0,
};

export const seedToday = toISO(new Date());

/* ---------------- buyer income & other costs ---------------- */

export type BuyerIncome = {
  id: string;
  buyer: string;
  description: string;
  amount: number;
  date: string; // ISO
  status: "Received" | "Pending";
};

export type OtherCost = { id: string; description: string; amount: number; date: string };

export const seedBuyerIncome: BuyerIncome[] = [
  { id: "BIN-1001", buyer: "Halstead Construction", description: "Camden site labour — monthly invoice", amount: 18500, date: addDays(todayISO(), -6), status: "Received" },
  { id: "BIN-1002", buyer: "Northline Logistics", description: "Hackney depot night shifts", amount: 9400, date: addDays(todayISO(), -14), status: "Received" },
  { id: "BIN-1003", buyer: "Brightway Facilities", description: "Stratford yard cleaning crew", amount: 6200, date: addDays(todayISO(), -21), status: "Pending" },
  { id: "BIN-1004", buyer: "Halstead Construction", description: "Overtime supplement — previous period", amount: 4100, date: addDays(todayISO(), -38), status: "Received" },
  { id: "BIN-1005", buyer: "Kestrel Retail Group", description: "Seasonal warehouse staffing", amount: 12750, date: addDays(todayISO(), -52), status: "Received" },
];

export const seedOtherCosts: OtherCost[] = [
  { id: "COST-2001", description: "Crew transport & fuel", amount: 1350, date: addDays(todayISO(), -5) },
  { id: "COST-2002", description: "PPE and site materials", amount: 880, date: addDays(todayISO(), -17) },
  { id: "COST-2003", description: "Equipment hire", amount: 1600, date: addDays(todayISO(), -44) },
];
