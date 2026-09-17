import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { apiClient } from "./api-client";
import type {
  Worker,
  Application,
  Attendance,
  Payroll,
  LocationItem,
  BuyerIncome,
  OtherCost,
  Settings,
  Notice,
} from "./mock-data";
import {
  addDays,
  addMonths,
  fmtDate,
  daysUntil,
  hoursBetween,
  hhmm,
  nowTime,
  rid,
  todayISO,
  weekStart,
  MONTHS,
  money,
  money2,
  proratedMonthlySalary,
} from "./hr-utils";

export type Role = "admin" | "worker" | "client";
export type Session = { email: string; name: string; role: Role; workerId?: string | undefined; clientId?: string | undefined; company?: string | undefined };

const SESSION_KEY = "workhr.session";

type Ctx = ReturnType<typeof useApiState>;
const ApiContext = createContext<Ctx | null>(null);

const round = (n: number) => Math.round(n * 100) / 100;

function useApiState() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [rejected, setRejected] = useState<Application[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [activity, setActivity] = useState<Notice[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openShifts, setOpenShifts] = useState<any[]>([]);
  const [buyerIncome, setBuyerIncome] = useState<BuyerIncome[]>([]);
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([]);
  const [currentWorkerId, setCurrentWorkerId] = useState<string>("");
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  /* ---------------- session / auth ---------------- */
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = localStorage.getItem(SESSION_KEY);
        const token = localStorage.getItem('auth_token');
        // Decode the JWT's exp — a session whose token is already dead is useless
        // and produces a wall of 401s; drop it so the user lands on the login page.
        const tokenAlive = (() => {
          if (!token) return false;
          try {
            const payload = JSON.parse(atob(token.split('.')[1] || ''));
            return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
          } catch {
            return false;
          }
        })();
        if (raw && tokenAlive) {
          const parsed = JSON.parse(raw) as Session;
          if (parsed?.role) {
            setSession(parsed);
            if (parsed.workerId) setCurrentWorkerId(parsed.workerId);
          }
        } else if (raw) {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem('auth_token');
        }
      }
    } catch {
      /* ignore */
    }
    setAuthReady(true);
  }, []);

  const login = async (email: string, password: string): Promise<Session | null> => {
    setLoading({ ...loading, login: true });
    setError(null);

    try {
      const response = await apiClient.post<{ token: string; user: Session }>('/api/auth/login', {
        email,
        password,
      });

      apiClient.setToken(response.token);
      const next = response.user;
      setSession(next);
      if (next.workerId) setCurrentWorkerId(next.workerId);

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          // Token is already set by apiClient.setToken(), which saves to 'auth_token'
        }
      } catch {
        /* ignore */
      }

      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      return null;
    } finally {
      setLoading({ ...loading, login: false });
    }
  };

  const workerLogin = async (workerCode: string, password: string): Promise<Session | null> => {
    setLoading({ ...loading, login: true });
    setError(null);

    try {
      const response = await apiClient.post<{ token: string; user: Session }>('/api/auth/worker/login', {
        workerCode,
        password,
      });

      apiClient.setToken(response.token);
      const next = response.user;
      setSession(next);
      if (next.workerId) setCurrentWorkerId(next.workerId);

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        }
      } catch {
        /* ignore */
      }

      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      return null;
    } finally {
      setLoading({ ...loading, login: false });
    }
  };

  const clientLogin = async (email: string, password: string): Promise<Session | null> => {
    setLoading({ ...loading, login: true });
    setError(null);

    try {
      const response = await apiClient.post<{ token: string; user: Session }>('/api/auth/client/login', {
        email,
        password,
      });

      apiClient.setToken(response.token);
      const next = response.user;
      setSession(next);

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        }
      } catch {
        /* ignore */
      }

      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      return null;
    } finally {
      setLoading({ ...loading, login: false });
    }
  };

  const logout = () => {
    setSession(null);
    apiClient.clearToken();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('auth_token');
      }
    } catch {
      /* ignore */
    }
  };

  /* ---------------- data loading ---------------- */
  const loadWorkers = async () => {
    setLoading({ ...loading, workers: true });
    setError(null);
    try {
      const data = await apiClient.get<Worker[]>('/api/workers');
      // Convert decimal fields from strings to numbers
      const normalizedData = data.map(w => ({
        ...w,
        rate: Number(w.rate),
        payType: w.payType === 'salary' ? 'salary' as const : 'hourly' as const,
        monthlySalary: w.monthlySalary != null ? Number(w.monthlySalary) : null
      }));
      setWorkers(normalizedData);
    } catch (err) {
      // Silently fail if not authenticated - user will be redirected to login
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load workers:', err);
        setError(err instanceof Error ? err.message : 'Failed to load workers');
      }
    } finally {
      setLoading({ ...loading, workers: false });
    }
  };

  const loadApplications = async () => {
    setLoading({ ...loading, applications: true });
    setError(null);
    try {
      const data = await apiClient.get<Application[]>('/api/applications');
      setApplications(data);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load applications:', err);
        setError(err instanceof Error ? err.message : 'Failed to load applications');
      }
    } finally {
      setLoading({ ...loading, applications: false });
    }
  };

  const loadAllApplications = async () => {
    setLoading({ ...loading, applications: true });
    setError(null);
    try {
      const pending = await apiClient.get<Application[]>('/api/applications');
      const approved = await apiClient.get<Application[]>('/api/applications?status=approved');
      setApplications([...pending, ...approved]);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load applications:', err);
        setError(err instanceof Error ? err.message : 'Failed to load applications');
      }
    } finally {
      setLoading({ ...loading, applications: false });
    }
  };

  const loadRejected = async () => {
    try {
      const data = await apiClient.get<Application[]>('/api/applications/rejected');
      setRejected(data);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load rejected applications:', err);
      }
    }
  };

  const loadAttendance = async () => {
    setLoading({ ...loading, attendance: true });
    setError(null);
    try {
      const data = await apiClient.get<any[]>('/api/attendance');
      // Convert database field names to frontend type and convert hours from string to number
      const normalizedData = data.map(a => ({
        id: a.id,
        workerId: a.worker_id,
        worker: a.worker,
        date: a.date,
        in: hhmm(a.check_in_time) || "",
        out: a.check_out_time ? hhmm(a.check_out_time) || "" : "",
        location: a.location,
        hours: Number(a.hours_worked),
        source: a.source,
        checkInLat: a.check_in_lat != null ? Number(a.check_in_lat) : null,
        checkInLng: a.check_in_lng != null ? Number(a.check_in_lng) : null,
        locationMismatch: a.location_mismatch === 1 || a.location_mismatch === true,
        assignmentStatus: a.assignment_status || 'none',
        nearestLocation: a.nearest_location ?? null,
        distanceMeters: a.distance_meters != null ? Number(a.distance_meters) : null,
        holidayAccruedHours: Number(a.holiday_accrued_hours ?? 0)
      }));
      setAttendance(normalizedData);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load attendance:', err);
        setError(err instanceof Error ? err.message : 'Failed to load attendance');
      }
    } finally {
      setLoading({ ...loading, attendance: false });
    }
  };

  const loadPayrolls = async () => {
    setLoading({ ...loading, payrolls: true });
    setError(null);
    try {
      const data = await apiClient.get<any[]>('/api/payroll');
      // Use the normalized camelCase fields from backend, just convert strings to numbers
      const normalizedData = data.map(p => ({
        id: p.id,
        workerId: p.workerId,
        worker: p.worker,
        from: p.periodStart,
        to: p.periodEnd,
        hours: Number(p.hours),
        overtime: Number(p.overtime),
        holidayHours: Number(p.holidayHours ?? 0),
        holidayPay: Number(p.holidayPay ?? 0),
        holidayAccruedHours: Number(p.holidayAccruedHours ?? 0),
        holidayAccrualPay: Number(p.holidayAccrualPay ?? 0),
        payType: p.payType === 'salary' ? 'salary' as const : 'hourly' as const,
        monthlySalary: p.monthlySalary != null ? Number(p.monthlySalary) : null,
        payDetails: p.payDetails ?? null,
        rate: Number(p.rate),
        gross: Number(p.gross),
        advance: Number(p.advanceDeduction),
        tax: Number(p.taxNi),
        net: Number(p.netPay),
        status: p.status,
        created: p.generatedAt
      }));
      setPayrolls(normalizedData);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load payrolls:', err);
        setError(err instanceof Error ? err.message : 'Failed to load payrolls');
      }
    } finally {
      setLoading({ ...loading, payrolls: false });
    }
  };

  const loadLocations = async () => {
    setLoading({ ...loading, locations: true });
    setError(null);
    try {
      const data = await apiClient.get<any[]>('/api/locations');
      setLocations(data.map(l => ({
        ...l,
        latitude: l.latitude != null ? Number(l.latitude) : null,
        longitude: l.longitude != null ? Number(l.longitude) : null,
        radiusMeters: l.radiusMeters != null ? Number(l.radiusMeters) : 200
      })));
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load locations:', err);
        setError(err instanceof Error ? err.message : 'Failed to load locations');
      }
    } finally {
      setLoading({ ...loading, locations: false });
    }
  };

  const loadSettings = async () => {
    try {
      const data = await apiClient.get<Settings>('/api/settings');
      // Convert decimal fields from strings to numbers
      const normalizedData = {
        ...data,
        hourlyRate: Number(data.hourlyRate),
        overtimeMultiplier: Number(data.overtimeMultiplier),
        overtimeThreshold: Number(data.overtimeThreshold),
        taxRate: Number(data.taxRate),
        niRate: Number(data.niRate),
        pensionRate: Number(data.pensionRate),
        maxAdvance: Number(data.maxAdvance),
        billingMultiplier: Number(data.billingMultiplier),
        holidayPayMultiplier: Number(data.holidayPayMultiplier ?? 2),
        holidayAccrualRate: Number(data.holidayAccrualRate ?? 12.07)
      };
      setSettings(normalizedData);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load settings:', err);
      }
    }
  };

  const loadBuyerIncome = async () => {
    setLoading({ ...loading, buyerIncome: true });
    setError(null);
    try {
      const data = await apiClient.get<BuyerIncome[]>('/api/buyer-income');
      // MySQL DECIMAL returns strings — coerce so sums don't concatenate
      setBuyerIncome((data || []).map((i) => ({ ...i, amount: Number(i.amount) || 0 })));
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load buyer income:', err);
        setError(err instanceof Error ? err.message : 'Failed to load buyer income');
      }
    } finally {
      setLoading({ ...loading, buyerIncome: false });
    }
  };

  const loadOtherCosts = async () => {
    setLoading({ ...loading, otherCosts: true });
    setError(null);
    try {
      const data = await apiClient.get<OtherCost[]>('/api/other-costs');
      // MySQL DECIMAL returns strings — coerce so sums don't concatenate
      setOtherCosts((data || []).map((c) => ({ ...c, amount: Number(c.amount) || 0 })));
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load other costs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load other costs');
      }
    } finally {
      setLoading({ ...loading, otherCosts: false });
    }
  };

  const loadNotifications = async () => {
    try {
      const data = await apiClient.get<Notice[]>('/api/notifications');
      setActivity(data);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('401'))) {
        console.error('Failed to load notifications:', err);
      }
    }
  };

  // Load initial data based on role - ONLY after session is confirmed
  useEffect(() => {
    if (session && session.role === 'admin' && authReady) {
      loadWorkers();
      loadAllApplications();
      loadRejected();
      loadAttendance();
      loadPayrolls();
      loadLocations();
      loadSettings();
      loadBuyerIncome();
      loadOtherCosts();
      loadNotifications();
    } else if (session && session.role === 'worker' && authReady) {
      loadLocations();
      loadMyAttendance();
    }
  }, [session, authReady]);

  const loadMyAttendance = async () => {
    try {
      // Use worker-specific endpoint if logged in as worker
      const endpoint = session?.role === 'worker' ? '/api/worker/attendance/my' : '/api/attendance/my';
      const data = await apiClient.get<any[]>(endpoint);
      // Map database field names to frontend type
      const normalizedData = data.map(a => ({
        id: a.id,
        workerId: a.worker_id,
        worker: a.worker,
        date: a.date,
        in: hhmm(a.check_in_time) || "",
        out: a.check_out_time ? hhmm(a.check_out_time) || "" : "",
        location: a.location,
        hours: Number(a.hours_worked),
        source: a.source,
        checkInLat: a.check_in_lat != null ? Number(a.check_in_lat) : null,
        checkInLng: a.check_in_lng != null ? Number(a.check_in_lng) : null,
        locationMismatch: a.location_mismatch === 1 || a.location_mismatch === true,
        assignmentStatus: a.assignment_status || 'none',
        nearestLocation: a.nearest_location ?? null,
        distanceMeters: a.distance_meters != null ? Number(a.distance_meters) : null,
        holidayAccruedHours: Number(a.holiday_accrued_hours ?? 0)
      }));
      setAttendance(normalizedData);
    } catch (err) {
      console.error('Failed to load my attendance:', err);
    }
  };

  /* ---------------- workers ---------------- */
  const addWorker = async (worker: Omit<Worker, 'id' | 'joined' | 'expiry'>) => {
    try {
      await apiClient.post('/api/workers', worker);
      await loadWorkers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add worker');
    }
  };

  const updateWorker = async (id: string, worker: Partial<Worker>) => {
    try {
      await apiClient.put(`/api/workers/${id}`, worker);
      await loadWorkers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update worker');
    }
  };

  const reactivateWorker = async (id: string) => {
    try {
      await apiClient.post(`/api/workers/${id}/reactivate`, {});
      await loadWorkers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reactivate worker');
    }
  };

  const deleteWorker = async (id: string) => {
    try {
      await apiClient.delete(`/api/workers/${id}`);
      await loadWorkers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worker');
    }
  };

  /* ---------------- applications ---------------- */
  const submitApplication = async (formData: FormData) => {
    try {
      const response = await apiClient.uploadFile<{ id: string; message: string }>('/applications', formData);
      // Do NOT call loadApplications() here - this is called from public register page
      // which doesn't have auth. Admin pages will reload applications when they mount.
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit application');
      throw err;
    }
  };

  const approveApplication = async (
    id: string,
    pay?: { rate?: number; payType?: "hourly" | "salary"; monthlySalary?: number },
  ) => {
    try {
      const response = await apiClient.post<{ id: string; expiry: string; workerId: string; rate: number; payType?: string; monthlySalary?: number | null; message: string; setupLink: string }>(
        `/api/applications/${id}/approve`,
        pay ?? {}
      );
      await loadApplications();
      // Don't load workers yet - they're not created until password setup
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve application');
      return null;
    }
  };

  const rejectApplication = async (id: string) => {
    try {
      await apiClient.post(`/api/applications/${id}/reject`, {});
      await loadApplications();
      await loadRejected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject application');
    }
  };

  const resendSetupLink = async (id: string) => {
    try {
      const response = await apiClient.post<{ message: string; setupLink: string }>(`/api/applications/${id}/resend-setup`, {});
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend setup link');
      return null;
    }
  };

  /* ---------------- attendance ---------------- */
  const addAttendance = async (entry: Omit<Attendance, 'id' | 'hours'>) => {
    try {
      // Map frontend field names to backend field names
      const backendEntry = {
        workerId: entry.workerId,
        date: entry.date,
        in: entry.in,
        out: entry.out,
        location: entry.location
      };
      const response = await apiClient.post<{ id: string; hours: number }>('/api/attendance', backendEntry);
      await loadAttendance();
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add attendance');
      return null;
    }
  };

  const updateAttendance = async (id: string, patch: Partial<Attendance>) => {
    try {
      // Map frontend field names to backend field names
      const backendPatch: any = {};
      if (patch.workerId) backendPatch.workerId = patch.workerId;
      if (patch.date) backendPatch.date = patch.date;
      if (patch.in) backendPatch.in = patch.in;
      if (patch.out) backendPatch.out = patch.out;
      if (patch.location) backendPatch.location = patch.location;
      if (patch.worker) backendPatch.worker = patch.worker;
      
      await apiClient.put(`/api/attendance/${id}`, backendPatch);
      await loadAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update attendance');
    }
  };

  const deleteAttendance = async (id: string) => {
    try {
      await apiClient.delete(`/api/attendance/${id}`);
      await loadAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete attendance');
    }
  };

  const checkIn = async (workerId: string, location: string) => {
    try {
      await apiClient.post('/api/attendance/checkin', { location });
      await loadMyAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in');
    }
  };

  const checkOut = async (workerId: string) => {
    try {
      await apiClient.post('/api/attendance/checkout', {});
      await loadMyAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check out');
    }
  };

  /* ---------------- worker attendance ---------------- */
  const loadTodayAttendance = async () => {
    try {
      const data = await apiClient.get<{ checkedIn: boolean; record: any }>('/api/worker/attendance/today');
      return data;
    } catch (err) {
      console.error('Failed to load today attendance:', err);
      return { checkedIn: false, record: null };
    }
  };

  const workerCheckIn = async (coords: { latitude: number; longitude: number }) => {
    try {
      const response = await apiClient.post<{ id: string; timeIn: string; location: string; locationMismatch?: boolean; distanceMeters?: number | null; nearestLocation?: string | null; assignmentStatus?: string; message: string }>(
        '/api/worker/attendance/checkin',
        { latitude: coords.latitude, longitude: coords.longitude }
      );
      await loadMyAttendance();
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in');
      throw err;
    }
  };

  const workerCheckOut = async () => {
    try {
      const response = await apiClient.post<{ hours: number; timeOut: string; message: string }>('/api/worker/attendance/checkout', {});
      await loadMyAttendance();
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check out');
      throw err;
    }
  };

  /* ---------------- payroll ---------------- */
  const createPayroll = async (workerId: string, from: string, to: string, advance: number) => {
    try {
      await apiClient.post('/api/payroll', { workerId, from, to, advance });
      await loadPayrolls();
      await loadNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payroll');
      throw err; // Re-throw so frontend can handle it
    }
  };

  const setPayrollStatus = async (id: string, status: Payroll["status"]) => {
    try {
      await apiClient.patch(`/payroll/${id}/status`, { status });
      await loadPayrolls();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payroll status');
    }
  };

  const deletePayroll = async (id: string) => {
    try {
      await apiClient.delete(`/api/payroll/${id}`);
      await loadPayrolls();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete payroll');
    }
  };

  /* ---------------- locations ---------------- */
  const addLocation = async (name: string, address: string, geo?: { latitude?: number | null; longitude?: number | null; radiusMeters?: number }) => {
    try {
      await apiClient.post('/api/locations', { name, address, ...geo });
      await loadLocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add location');
    }
  };

  const updateLocation = async (id: string, patch: Partial<LocationItem>) => {
    try {
      await apiClient.put(`/api/locations/${id}`, patch);
      await loadLocations();
      await loadWorkers(); // Location name changes affect workers
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update location');
    }
  };

  const deleteLocation = async (id: string) => {
    try {
      await apiClient.delete(`/api/locations/${id}`);
      await loadLocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
    }
  };

  /* ---------------- buyer income ---------------- */
  const addBuyerIncome = async (input: Omit<BuyerIncome, "id">) => {
    try {
      await apiClient.post('/api/buyer-income', input);
      await loadBuyerIncome();
      await loadNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add buyer income');
    }
  };

  const updateBuyerIncome = async (id: string, patch: Partial<BuyerIncome>) => {
    try {
      await apiClient.put(`/api/buyer-income/${id}`, patch);
      await loadBuyerIncome();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update buyer income');
    }
  };

  const deleteBuyerIncome = async (id: string) => {
    try {
      await apiClient.delete(`/api/buyer-income/${id}`);
      await loadBuyerIncome();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete buyer income');
    }
  };

  /* ---------------- other costs ---------------- */
  const addOtherCost = async (input: Omit<OtherCost, "id">) => {
    try {
      await apiClient.post('/api/other-costs', input);
      await loadOtherCosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add other cost');
    }
  };

  const updateOtherCost = async (id: string, patch: Partial<OtherCost>) => {
    try {
      await apiClient.put(`/api/other-costs/${id}`, patch);
      await loadOtherCosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update other cost');
    }
  };

  const deleteOtherCost = async (id: string) => {
    try {
      await apiClient.delete(`/api/other-costs/${id}`);
      await loadOtherCosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete other cost');
    }
  };

  /* ---------------- settings ---------------- */
  const updateSettings = async (patch: Partial<Settings>) => {
    try {
      // Convert number fields to ensure they're sent as numbers, not strings
      const normalizedPatch = {
        ...patch,
        hourlyRate: patch.hourlyRate !== undefined ? Number(patch.hourlyRate) : undefined,
        overtimeMultiplier: patch.overtimeMultiplier !== undefined ? Number(patch.overtimeMultiplier) : undefined,
        overtimeThreshold: patch.overtimeThreshold !== undefined ? Number(patch.overtimeThreshold) : undefined,
        taxRate: patch.taxRate !== undefined ? Number(patch.taxRate) : undefined,
        niRate: patch.niRate !== undefined ? Number(patch.niRate) : undefined,
        pensionRate: patch.pensionRate !== undefined ? Number(patch.pensionRate) : undefined,
        maxAdvance: patch.maxAdvance !== undefined ? Number(patch.maxAdvance) : undefined,
        billingMultiplier: patch.billingMultiplier !== undefined ? Number(patch.billingMultiplier) : undefined,
        holidayPayMultiplier: patch.holidayPayMultiplier !== undefined ? Number(patch.holidayPayMultiplier) : undefined,
        holidayAccrualRate: patch.holidayAccrualRate !== undefined ? Number(patch.holidayAccrualRate) : undefined
      };
      await apiClient.put('/api/settings', normalizedPatch);
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  };

  /* ---------------- derived calculations ---------------- */
  const workerStatus = (w: Worker): any => {
    // Expired visa is a legal work block — surface it before everything else.
    if (w.visaExpiry && daysUntil(w.visaExpiry) <= 0) return "Visa Expired";
    const left = daysUntil(w.expiry);
    if (left < 0) return "Expired";
    if (w.onLeave) return "On Leave";
    if (left <= (settings?.firstReminderDays || 30)) return "Expiring Soon";
    return "Active";
  };

  const expiryNotices = useMemo(() => {
    if (!settings) return [];
    return workers
      .map((w) => {
        const left = daysUntil(w.expiry);
        if (left > (settings.firstReminderDays || 30)) return null;
        const urgency: Notice["urgency"] = left <= (settings.finalReminderDays || 7) ? "critical" : "warning";
        const message =
          left < 0
            ? `Contract expired ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago (${fmtDate(w.expiry)})`
            : `Contract expires in ${left} day${left === 1 ? "" : "s"} (${fmtDate(w.expiry)})`;
        return { id: `EXP-${w.id}`, worker: w.name, workerId: w.id, message, urgency, occurred_at: fmtDate(w.expiry) };
      })
      .filter(Boolean) as Notice[];
  }, [workers, settings]);

  // Visa expiry notices (Phase E): computed live from workers' visaExpiry,
  // recalculates on every load/poll just like the contract-expiry notices.
  const visaNotices = useMemo(() => {
    return workers
      .map((w) => {
        if (!w.visaExpiry) return null;
        const left = daysUntil(w.visaExpiry);
        if (left > 90) return null;
        const urgency: Notice["urgency"] = left <= 7 ? "critical" : "warning";
        const message =
          left < 0
            ? `Visa EXPIRED ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago — cannot legally continue working, action required`
            : `Visa expires in ${left} day${left === 1 ? "" : "s"} — expired visas cannot legally continue working, action required`;
        return {
          id: `VISA-${w.id}`,
          worker: w.name,
          workerId: w.id,
          message,
          urgency,
          occurred_at: fmtDate(w.visaExpiry),
          category: "visa",
        };
      })
      .filter(Boolean) as Notice[];
  }, [workers]);

  const notices = useMemo(() => [...expiryNotices, ...visaNotices, ...activity], [expiryNotices, visaNotices, activity]);

  const payrollChart = useMemo(() => {
    const buckets: { key: string; month: string; cost: number; expense: number }[] = [];
    for (let i = 8; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        month: MONTHS[d.getMonth()]!,
        cost: 0,
        expense: 0,
      });
    }
    for (const p of payrolls) {
      const b = buckets.find((x) => x.key === p.created.slice(0, 7));
      if (!b) continue;
      b.cost = round(b.cost + p.gross);
      b.expense = round(b.expense + p.tax + p.advance);
    }
    return buckets;
  }, [payrolls]);

  const deductionsData = useMemo(() => {
    const advances = round(payrolls.reduce((s, p) => s + p.advance, 0));
    const tax = round(payrolls.reduce((s, p) => s + p.tax, 0));
    const pension = round(payrolls.reduce((s, p) => s + p.gross * ((settings?.pensionRate || 5) / 100), 0));
    return [
      { name: "Advances", value: advances },
      { name: "Tax & NI", value: tax },
      { name: "Pension", value: pension },
    ];
  }, [payrolls, settings]);

  // Pay-aware cost helpers (Part 2): hourly rows cost hours × rate; salaried
  // workers cost their monthly salary prorated by calendar days — attendance
  // is tracked for records but never multiplied by a rate for them.
  const hourlyRowCost = (a: Attendance) => {
    const w = workers.find((x) => x.id === a.workerId);
    if (w?.payType === "salary") return 0; // salaried cost is calendar-based, added separately
    return a.hours * (w?.rate ?? settings?.hourlyRate ?? 14.5);
  };
  const salaryCostForRange = (from: string, to: string) =>
    workers
      .filter((w) => w.payType === "salary" && (w.monthlySalary ?? 0) > 0)
      .reduce((t, w) => t + proratedMonthlySalary(Number(w.monthlySalary), from, to, w.joined).amount, 0);

  const weeklyReport = useMemo(() => {
    const starts: string[] = [];
    for (let i = 5; i >= 0; i--) starts.push(weekStart(addDays(todayISO(), -7 * i)));
    return starts.map((s, idx) => {
      const end = addDays(s, 6);
      const rows = attendance.filter((a) => a.date >= s && a.date <= end);
      const hours = round(rows.reduce((t, a) => t + a.hours, 0));
      const cost = round(
        rows.reduce((t, a) => t + hourlyRowCost(a), 0) + salaryCostForRange(s, end),
      );
      return {
        week: `W${idx + 1}`,
        label: fmtDate(s),
        hours,
        cost,
        billing: round(cost * (settings?.billingMultiplier || 1.45)),
      };
    });
  }, [attendance, workers, settings]);

  const totals = useMemo(() => {
    const totalHours = round(attendance.reduce((t, a) => t + a.hours, 0));
    // All-time labour cost: hourly attendance cost + salaried workers' prorated
    // salary from their join date to today.
    const labourCost = round(
      attendance.reduce((t, a) => t + hourlyRowCost(a), 0) +
        workers
          .filter((w) => w.payType === "salary" && (w.monthlySalary ?? 0) > 0)
          .reduce((t, w) => {
            const from = w.joined ? String(w.joined).slice(0, 10) : todayISO();
            return t + proratedMonthlySalary(Number(w.monthlySalary), from, todayISO(), w.joined).amount;
          }, 0),
    );
    const billing = round(labourCost * (settings?.billingMultiplier || 1.45));
    const payrollCost = round(payrolls.reduce((t, p) => t + p.gross, 0));
    const pending = round(payrolls.filter((p) => p.status === "Pending").reduce((t, p) => t + p.net, 0));
    const expenses = round(payrolls.reduce((t, p) => t + p.tax + p.advance, 0));
    return {
      totalHours,
      labourCost,
      billing,
      profit: round(billing - labourCost),
      payrollCost,
      pending,
      pendingCount: payrolls.filter((p) => p.status === "Pending").length,
      expenses,
      activeWorkers: workers.filter((w) => daysUntil(w.expiry) >= 0).length,
      expiringSoon: workers.filter((w) => {
        const l = daysUntil(w.expiry);
        return l >= 0 && l <= (settings?.firstReminderDays || 30);
      }).length,
    };
  }, [attendance, workers, payrolls, settings]);

  return {
    session,
    authReady,
    login,
    workerLogin,
    logout,
    workers,
    applications,
    rejected,
    attendance,
    payrolls,
    locations,
    activity,
    settings,
    openShifts,
    currentWorkerId,
    setCurrentWorkerId,
    loading,
    error,
    setError,
    submitApplication,
    approveApplication,
    rejectApplication,
    resendSetupLink,
    addAttendance,
    updateAttendance,
    deleteAttendance,
    checkIn,
    checkOut,
    loadTodayAttendance,
    workerCheckIn,
    workerCheckOut,
    createPayroll,
    setPayrollStatus,
    deletePayroll,
    addLocation,
    updateLocation,
    deleteLocation,
    addWorker,
    updateWorker,
    reactivateWorker,
    deleteWorker,
    workerStatus,
    updateSettings,
    expiryNotices,
    notices,
    payrollChart,
    deductionsData,
    weeklyReport,
    totals,
    buyerIncome,
    otherCosts,
    addBuyerIncome,
    updateBuyerIncome,
    deleteBuyerIncome,
    addOtherCost,
    updateOtherCost,
    deleteOtherCost,
    loadWorkers,
    loadApplications,
    loadAllApplications,
    loadAttendance,
    loadPayrolls,
    loadLocations,
    loadBuyerIncome,
    loadOtherCosts,
    refreshData: () => {
      if (session?.role === 'admin') {
        loadWorkers();
        loadApplications();
        loadAttendance();
        loadPayrolls();
        loadBuyerIncome();
        loadOtherCosts();
        loadNotifications();
      }
    },
  };
}

export function ApiProvider({ children }: { children: ReactNode }) {
  const value = useApiState();
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside ApiProvider");
  return ctx;
}