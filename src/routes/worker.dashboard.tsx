import { useState, useEffect, useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { LogOut, Clock, LogIn, Calendar, MapPin, Navigation, FileSignature, Eraser } from "lucide-react";

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
  const [actionLoading, setActionLoading] = useState(false);
  // Phase G Part 2: pending signature requests
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);
  const [signing, setSigning] = useState<any | null>(null);

  const loadMyDocs = async () => {
    try {
      const rows = await apiClient.get<any[]>('/api/documents/requests/mine');
      setPendingDocs((rows || []).filter((r) => r.status === 'pending'));
    } catch (e) { console.error('Load my documents failed:', e); }
  };
  // Phase E: GPS must be captured before check-in is allowed
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");

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
    // Load worker-specific data only (check-in location is auto-detected by GPS)
    loadMyDocs();
    loadTodayAttendance().then((todayData) => {
      setCheckedIn(todayData.checkedIn);
      setVisaExpired(Boolean(todayData.visaExpired));
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load worker data:', err);
      setLoading(false);
    });
  }, [session, router]);

  const enableLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("denied");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  const handleCheckIn = async () => {
    if (!coords) {
      alert('Location access is required to check in. Please enable location services.');
      return;
    }
    setActionLoading(true);
    try {
      await workerCheckIn(coords);
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
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-3 h-3 rounded-full bg-muted-foreground" />
                <span>You are not checked in</span>
              </div>

              {/* GPS capture is required before check-in */}
              {geoStatus === "granted" && coords ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Navigation className="size-4" />
                  <span>Location on ({coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)})</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={enableLocation}
                    disabled={geoStatus === "requesting"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary disabled:opacity-50"
                  >
                    <Navigation className="size-4" />
                    {geoStatus === "requesting" ? "Locating..." : "Turn on location"}
                  </button>
                  {geoStatus === "denied" && (
                    <p className="text-sm text-danger">
                      Location access is required to check in. Please enable location services.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end">
                <button
                  onClick={handleCheckIn}
                  disabled={actionLoading || !coords}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <LogIn className="size-4" />
                  {actionLoading ? 'Checking in...' : 'Check In'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Documents to Sign */}
        {pendingDocs.length > 0 && (
          <div className="bg-card rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileSignature className="size-5" />
              Documents to Sign
            </h2>
            <div className="divide-y divide-border">
              {pendingDocs.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{d.document_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Sent {new Date(d.sent_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => setSigning(d)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                  >
                    <FileSignature className="size-4" /> Review &amp; Sign
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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

      {signing && (
        <SignModal
          request={signing}
          onClose={() => setSigning(null)}
          onDone={() => { setSigning(null); loadMyDocs(); }}
        />
      )}
    </div>
  );
}

/* ---------- Signature pad (draw on canvas) ---------- */
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    c.width = c.offsetWidth;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="w-full h-40 rounded-lg border border-border bg-white touch-none cursor-crosshair"
        onPointerDown={(e) => {
          drawing.current = true;
          hasInk.current = true;
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      <button
        type="button"
        onClick={() => {
          const c = ref.current!;
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
          hasInk.current = false;
          onChange(null);
        }}
        className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Eraser className="size-3" /> Clear
      </button>
    </div>
  );
}

/* ---------- Sign / decline modal ---------- */
function SignModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [method, setMethod] = useState<'draw' | 'type' | 'upload'>('draw');
  const [drawData, setDrawData] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [uploadData, setUploadData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiClient.get(`/api/documents/requests/${request.id}`);
        setDetail(d);
        await apiClient.post(`/api/documents/requests/${request.id}/view`, {});
      } catch (e) {
        setDetail({ error: true });
      }
    })();
  }, [request.id]);

  const signatureReady =
    (method === 'draw' && !!drawData) ||
    (method === 'type' && typedName.trim().length > 0) ||
    (method === 'upload' && !!uploadData);

  const signatureData =
    method === 'draw' ? drawData : method === 'type' ? typedName.trim() : uploadData;

  const act = async (action: 'sign' | 'decline') => {
    setBusy(true);
    setErr(null);
    try {
      if (action === 'sign') {
        await apiClient.post(`/api/documents/requests/${request.id}/sign`, {
          signatureType: method,
          signatureData,
        });
      } else {
        await apiClient.post(`/api/documents/requests/${request.id}/decline`, {});
      }
      onDone();
    } catch (e: any) {
      setErr(e.message || `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const fileUrl = detail?.file_path
    ? `http://localhost:3001/${String(detail.file_path).replace(/\\/g, '/')}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold">{request.document_name}</h3>
            <p className="text-xs text-muted-foreground">Review the document, then sign or decline.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {detail === null && <p className="text-sm text-muted-foreground">Loading document...</p>}
          {detail?.error && <p className="text-sm text-danger">Failed to load document.</p>}
          {detail?.rendered_content && (
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-4 text-sm">{detail.rendered_content}</pre>
          )}
          {!detail?.rendered_content && fileUrl && (
            <embed src={fileUrl} type="application/pdf" className="h-80 w-full rounded-lg border border-border" />
          )}

          <div>
            <p className="text-sm font-medium mb-2">Sign with:</p>
            <div className="flex gap-2 mb-3">
              {(['draw', 'type', 'upload'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${method === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                >
                  {m === 'draw' ? 'Draw' : m === 'type' ? 'Type' : 'Upload'}
                </button>
              ))}
            </div>
            {method === 'draw' && <DrawPad onChange={setDrawData} />}
            {method === 'type' && (
              <div>
                <input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type your full name"
                  className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                />
                {typedName.trim() && (
                  <p className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-2xl italic" style={{ fontFamily: 'cursive' }}>
                    {typedName}
                  </p>
                )}
              </div>
            )}
            {method === 'upload' && (
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) { setUploadData(null); return; }
                  const r = new FileReader();
                  r.onload = () => setUploadData(String(r.result));
                  r.readAsDataURL(f);
                }}
                className="w-full h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            )}
            {method === 'upload' && uploadData && (
              <img src={uploadData} alt="Signature preview" className="mt-2 max-h-20 rounded border border-border bg-white" />
            )}
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <button
            onClick={() => act('decline')}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-danger/40 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
          >
            Decline
          </button>
          <button
            onClick={() => act('sign')}
            disabled={busy || !signatureReady}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            <FileSignature className="size-4" /> {busy ? 'Signing...' : 'Confirm & Sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
