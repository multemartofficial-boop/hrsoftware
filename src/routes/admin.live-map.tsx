import { useEffect, useRef, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, Th, Td, EmptyRow, Person, StatusBadge } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/admin/live-map")({
  head: () => ({
    meta: [
      { title: "Live Map — WorkHR" },
      { name: "description", content: "Live map of currently checked-in workers vs configured locations." },
    ],
  }),
  component: LiveMapPage,
});

type ActiveShift = {
  id: string;
  worker_id: string;
  worker: string;
  date: string;
  check_in_time: string;
  location: string;
  check_in_lat: number | string | null;
  check_in_lng: number | string | null;
  location_mismatch: number | boolean;
  nearest_location: string | null;
  distance_meters: number | string | null;
  worker_address: string | null;
};

const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
};

const dotIcon = (color: string, ring = "#fff") =>
  L.divIcon({
    className: "",
    html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const locIcon = L.divIcon({
  className: "",
  html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
  </span>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

function LiveMapPage() {
  const { locations } = useApi();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [shifts, setShifts] = useState<ActiveShift[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const loadShifts = async () => {
    try {
      const data = await apiClient.get<ActiveShift[]>("/api/attendance/active/shifts");
      setShifts(data);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Live map refresh failed:", e);
    }
  };

  // Init map once
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([51.53, -0.1], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapObj.current = map;
    return () => {
      map.remove();
      mapObj.current = null;
    };
  }, []);

  // Poll every 45s
  useEffect(() => {
    loadShifts();
    const id = setInterval(loadShifts, 45_000);
    return () => clearInterval(id);
  }, []);

  // Redraw markers whenever data changes
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const points: [number, number][] = [];

    // Location pins (blue squares)
    for (const loc of locations || []) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      L.marker([lat, lng], { icon: locIcon })
        .bindPopup(`<strong>${loc.name}</strong><br/>${loc.address}<br/><em>Radius: ${loc.radiusMeters ?? 200}m</em>`)
        .addTo(layer);
      // Circle showing the geofence radius
      L.circle([lat, lng], {
        radius: loc.radiusMeters ?? 200,
        color: "#2563eb",
        weight: 1,
        fillOpacity: 0.06,
      }).addTo(layer);
      points.push([lat, lng]);
    }

    // Worker pins (green = matched, red = mismatch) — only those with GPS
    for (const s of shifts) {
      if (s.check_in_lat == null || s.check_in_lng == null) continue;
      const lat = Number(s.check_in_lat);
      const lng = Number(s.check_in_lng);
      const mismatch = s.location_mismatch === 1 || s.location_mismatch === true;
      const loc = (locations || []).find((l) => l.name === s.location);
      const dist = s.distance_meters != null
        ? Number(s.distance_meters)
        : loc?.latitude != null && loc?.longitude != null
          ? haversineMeters(lat, lng, Number(loc.latitude), Number(loc.longitude))
          : null;
      const icon = dotIcon(mismatch ? "#dc2626" : "#16a34a");
      const distLine = dist != null
        ? `<br/>${mismatch ? `<span style="color:#dc2626;font-weight:600">Location Mismatch — ${dist}m off${s.nearest_location ? ` (nearest: ${s.nearest_location})` : ""}</span>` : `<span style="color:#16a34a">Within radius — ${dist}m</span>`}`
        : "";
      L.marker([lat, lng], { icon })
        .bindPopup(
          `<strong>${s.worker}</strong><br/>Location: ${s.location}<br/>Checked in: ${s.check_in_time}${distLine}`
        )
        .addTo(layer);
      points.push([lat, lng]);
    }

    if (points.length > 0 && mapObj.current) {
      mapObj.current.fitBounds(L.latLngBounds(points).pad(0.15));
    }
  }, [shifts, locations]);

  const manualRefresh = () => {
    setRefreshing(true);
    loadShifts().finally(() => setTimeout(() => setRefreshing(false), 400));
  };

  const activeCount = useMemo(() => shifts.length, [shifts]);

  return (
    <AdminShell
      title="Live Map"
      action={
        <button
          onClick={manualRefresh}
          className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="size-4 text-primary" />
            <span className="font-medium">{activeCount} worker{activeCount === 1 ? "" : "s"} checked in</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full bg-[#16a34a]" /> Matched</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full bg-[#dc2626]" /> Location Mismatch</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded bg-[#2563eb]" /> Location</span>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            Auto-refreshes every 45s · Last updated {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
        <div ref={mapRef} className="h-[calc(100vh-22rem)] min-h-100 w-full" />
      </Card>

      {/* Checked-in workers list */}
      <Card className="mt-4 p-0">
        <div className="p-5">
          <h2 className="text-base font-semibold">Checked-in workers ({shifts.length})</h2>
        </div>
        <DataTable
          labels={["Worker", "Code", "Address", "Location", "Status"]}
          head={
            <>
              <Th>Worker</Th>
              <Th>Code</Th>
              <Th>Address</Th>
              <Th>Location</Th>
              <Th>Status</Th>
            </>
          }
        >
          {shifts.length === 0 && <EmptyRow colSpan={5} text="No workers are currently checked in." />}
          {shifts.map((s) => {
            const mismatch = s.location_mismatch === 1 || s.location_mismatch === true;
            const status = s.location === "Unknown/Unmatched"
              ? "Unknown/Unmatched"
              : mismatch ? "Location Mismatch" : "Matched";
            return (
              <tr key={s.id} className="hover:bg-secondary/40">
                <Td><Person name={s.worker} /></Td>
                <Td className="font-medium">{s.worker_id}</Td>
                <Td><span className="block max-w-56 truncate" title={s.worker_address || ""}>{s.worker_address || "—"}</span></Td>
                <Td>{s.location}</Td>
                <Td><StatusBadge status={status} /></Td>
              </tr>
            );
          })}
        </DataTable>
      </Card>
    </AdminShell>
  );
}
