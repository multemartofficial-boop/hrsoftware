import { useState, useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { LogOut, Clock, LogIn, Calendar, MapPin } from "lucide-react";
import { inputCls } from "@/components/hr/bits";

export const Route = createFileRoute("/worker/dashboard")({
  head: () => ({
    meta: [
      { title: "Worker Dashboard — WorkHR" },
      { name: "description", content: "Worker attendance management" },
    ],
  }),
  component: WorkerDashboard,
});

function WorkerDashboard() {
  const router = useRouter();
  const { session, logout, workerCheckIn, workerCheckOut, attendance } = useApi();
  const [checkedIn, setCheckedIn] = useState(false);
  const [visaExpired, setVisaExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);

  const loadTodayAttendance = async (): Promise<{ checkedIn: boolean; record: any; visaExpired?: boolean }> => {
    try {
      return await apiClient.get<{ checkedIn: boolean; record: any; visaExpired?: boolean }>('/api/worker/attendance/today');
    } catch (err) {
      console.error('Failed to load today attendance:', err);
      return { checkedIn: false, record: null };
    }
  };

  useEffect(() => {
    if (!session || session.role !== 'worker') {
      router.navigate({ to: '/' });
      return;
    }
    // Load worker-specific data only
    Promise.all([
      loadTodayAttendance(),
      apiClient.get<any[]>('/api/locations').then(data => setLocations(data || []))
    ]).then(([todayData]) => {
      setCheckedIn(todayData.checkedIn);
      setVisaExpired(Boolean(todayData.visaExpired));
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load worker data:', err);
      setLoading(false);
    });
  }, [session, router]);

  const handleCheckIn = async () => {
    if (!selectedLocation) {
      alert('Please select a location');
      return;
    }
    setActionLoading(true);
    try {
      await workerCheckIn(selectedLocation);
      setCheckedIn(true);
    } catch (err: any) {
      alert(err.message || 'Failed to check in');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setActionLoading(true);
    try {
      await workerCheckOut();
      setCheckedIn(false);
    } catch (err: any) {
      alert(err.message || 'Failed to check out');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.navigate({ to: '/' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const myAttendance = attendance?.filter(a => a.workerId === session?.workerId) || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">WorkHR</h1>
            <span className="text-muted-foreground">|</span>
            <span className="text-sm">Worker Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{session?.name}</span>
              <span className="text-xs text-muted-foreground">({session?.workerId})</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Check In/Out Section */}
        <div className="bg-card rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="size-5" />
            Today's Attendance
          </h2>

          {checkedIn ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-green-600">
                <div className="w-3 h-3 rounded-full bg-green-600" />
                <span className="font-medium">You are checked in</span>
              </div>
              <button
                onClick={handleCheckOut}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <LogOut className="size-4" />
                {actionLoading ? 'Checking out...' : 'Check Out'}
              </button>
            </div>
          ) : visaExpired ? (
            <div className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-danger">
              <LogIn className="size-5 shrink-0" />
              <div>
                <p className="font-medium">Your visa has expired.</p>
                <p className="text-sm">
                  You cannot check in until this is resolved. Please contact your administrator.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-3 h-3 rounded-full bg-muted-foreground" />
                <span>You are not checked in</span>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select location</option>
                  {locations?.map((loc) => (
                    <option key={loc.id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCheckIn}
                  disabled={actionLoading || !selectedLocation}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <LogIn className="size-4" />
                  {actionLoading ? 'Checking in...' : 'Check In'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Attendance History */}
        <div className="bg-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="size-5" />
            My Attendance History
          </h2>
          
          {myAttendance.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No attendance records yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Date</th>
                    <th className="text-left py-3 px-4 font-medium">Location</th>
                    <th className="text-left py-3 px-4 font-medium">Check In</th>
                    <th className="text-left py-3 px-4 font-medium">Check Out</th>
                    <th className="text-left py-3 px-4 font-medium">Hours</th>
                    <th className="text-left py-3 px-4 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {myAttendance.map((a) => (
                    <tr key={a.id} className="border-b hover:bg-secondary/40">
                      <td className="py-3 px-4">{new Date(a.date).toLocaleDateString()}</td>
                      <td className="py-3 px-4 flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        {a.location}
                      </td>
                      <td className="py-3 px-4">{a.in}</td>
                      <td className="py-3 px-4">{a.out || '-'}</td>
                      <td className="py-3 px-4 font-medium">{a.hours.toFixed(2)}h</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-xs ${
                          a.source === 'Self' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {a.source}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
