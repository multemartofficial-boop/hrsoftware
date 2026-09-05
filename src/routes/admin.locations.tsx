import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Plus, MapPin, Pencil, Trash2, Users, Search, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, Field, GhostButton, Modal, PrimaryButton, inputCls } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import type { LocationItem } from "@/lib/mock-data";

export const Route = createFileRoute("/admin/locations")({
  head: () => ({
    meta: [
      { title: "Locations — WorkHR" },
      { name: "description", content: "Manage the work locations workers can check in to." },
      { property: "og:title", content: "Locations — WorkHR" },
      { property: "og:description", content: "Manage the work locations workers can check in to." },
    ],
  }),
  component: LocationsPage,
});

const pinIcon = L.divIcon({
  className: "",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="var(--primary)" stroke="#fff" stroke-width="1.5"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>`,
});

function LocationMapPicker({
  lat,
  lng,
  radius,
  onPick,
  onSearchSelect,
}: {
  lat: number | null;
  lng: number | null;
  radius: number;
  onPick: (lat: number, lng: number) => void;
  onSearchSelect: (address: string) => void;
}) {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onPickRef = useRef(onPick);
  const onSearchRef = useRef(onSearchSelect);
  onPickRef.current = onPick;
  onSearchRef.current = onSearchSelect;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const placePin = (la: number, lo: number, fly = false) => {
    const map = mapObj.current;
    if (!map) return;
    const ll = L.latLng(la, lo);
    if (markerRef.current) markerRef.current.setLatLng(ll);
    else {
      markerRef.current = L.marker(ll, { icon: pinIcon, draggable: true })
        .addTo(map)
        .on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          onPickRef.current(p.lat, p.lng);
        });
    }
    if (circleRef.current) circleRef.current.setLatLng(ll);
    else {
      circleRef.current = L.circle(ll, {
        radius,
        color: "var(--primary)",
        weight: 1.5,
        fillColor: "var(--primary)",
        fillOpacity: 0.12,
      }).addTo(map);
    }
    if (fly) map.flyTo(ll, Math.max(map.getZoom(), 15));
  };

  useEffect(() => {
    if (!mapDiv.current || mapObj.current) return;
    const map = L.map(mapDiv.current).setView([51.5072, -0.1276], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapObj.current = map;
    map.on("click", (e: L.LeafletMouseEvent) => {
      placePin(e.latlng.lat, e.latlng.lng);
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });
    if (lat != null && lng != null) {
      placePin(lat, lng);
      map.setView([lat, lng], 15);
    }
    // Leaflet needs a nudge once the modal finishes rendering
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapObj.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pin/circle in sync when lat/lng/radius change from outside (slider, search, manual edit)
  useEffect(() => {
    if (lat != null && lng != null && mapObj.current) placePin(lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  useEffect(() => {
    circleRef.current?.setRadius(radius > 0 ? radius : 1);
  }, [radius]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "en" } },
      );
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!data.length) {
        setSearchErr("No results found — try a more specific address.");
      } else {
        const first = data[0]!;
        const la = Number(first.lat);
        const lo = Number(first.lon);
        placePin(la, lo, true);
        onPickRef.current(la, lo);
        onSearchRef.current(first.display_name);
      }
    } catch {
      setSearchErr("Search failed — check your connection and try again.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <form onSubmit={search} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputCls} mt-0 pl-9 pr-10`}
          placeholder="Search an address or place…"
        />
        <button
          type="submit"
          disabled={searching}
          className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
          aria-label="Search address"
        >
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </button>
      </form>
      {searchErr && <p className="mt-1 text-xs font-medium text-danger">{searchErr}</p>}
      <div ref={mapDiv} className="mt-3 h-64 w-full rounded-xl border border-border" />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Click the map or drag the pin to set the location. The circle shows the geofence radius.
      </p>
    </div>
  );
}

function LocationForm({ editing, onClose }: { editing: LocationItem | null; onClose: () => void }) {
  const { addLocation, updateLocation } = useApi();
  const [name, setName] = useState(editing?.name ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [latitude, setLatitude] = useState(editing?.latitude != null ? String(editing.latitude) : "");
  const [longitude, setLongitude] = useState(editing?.longitude != null ? String(editing.longitude) : "");
  const [radiusMeters, setRadiusMeters] = useState(String(editing?.radiusMeters ?? 200));
  const [geoErr, setGeoErr] = useState<string | null>(null);

  const latNum = latitude !== "" && !Number.isNaN(Number(latitude)) ? Number(latitude) : null;
  const lngNum = longitude !== "" && !Number.isNaN(Number(longitude)) ? Number(longitude) : null;
  const radNum = radiusMeters !== "" && !Number.isNaN(Number(radiusMeters)) ? Number(radiusMeters) : 200;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (latNum == null || lngNum == null) {
      setGeoErr("Pick a point on the map (search or click) to set the coordinates.");
      return;
    }
    const geo = { latitude: latNum, longitude: lngNum, radiusMeters: radNum > 0 ? radNum : 200 };
    if (editing) updateLocation(editing.id, { name, address, ...geo });
    else addLocation(name, address, geo);
    onClose();
  };

  return (
    <Modal
      title={editing ? "Edit location" : "Add location"}
      description="Search or click the map to place the pin — the circle shows the geofence radius."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Location name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Camden Site" />
        </Field>
        <Field label="Address" hint="Filled automatically when you search — editable if needed.">
          <input required value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="24 Camden High St, London" />
        </Field>
        <Field label="Location on map" error={geoErr ?? undefined}>
          <LocationMapPicker
            lat={latNum}
            lng={lngNum}
            radius={radNum}
            onPick={(la, lo) => {
              setLatitude(la.toFixed(6));
              setLongitude(lo.toFixed(6));
              setGeoErr(null);
            }}
            onSearchSelect={(a) => setAddress(a)}
          />
        </Field>
        <Field label="Geofence radius" hint="Workers must be within this distance to check in.">
          <div className="mt-1.5 flex items-center gap-3">
            <input
              type="range"
              min="25"
              max="2000"
              step="25"
              value={Math.min(Math.max(radNum, 25), 2000)}
              onChange={(e) => setRadiusMeters(e.target.value)}
              className="h-2 flex-1 accent-primary"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="1"
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(e.target.value)}
                className="h-10 w-24 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                placeholder="200"
              />
              <span className="text-sm text-muted-foreground">m</span>
            </div>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <input readOnly value={latitude} className={`${inputCls} bg-secondary text-muted-foreground`} placeholder="—" />
          </Field>
          <Field label="Longitude">
            <input readOnly value={longitude} className={`${inputCls} bg-secondary text-muted-foreground`} placeholder="—" />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit">{editing ? "Save changes" : "Add location"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function LocationsPage() {
  const { locations, workers, deleteLocation, loading, error, loadLocations } = useApi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationItem | null>(null);

  const start = (l: LocationItem | null) => {
    setEditing(l);
    setOpen(true);
  };

  if (loading.locations) {
    return (
      <AdminShell title="Locations">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading locations...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Locations">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load locations</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => loadLocations()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Locations"
      action={
        <button
          onClick={() => start(null)}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" /> Add Location
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(locations || []).map((l) => (
          <Card key={l.id}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">{l.name}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{l.address}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" /> {workers ? workers.filter(w => w.location === l.name).length : 0} workers assigned
              </span>
              <div className="flex gap-1 text-muted-foreground">
                <button onClick={() => start(l)} className="rounded-md p-1.5 hover:bg-secondary hover:text-primary">
                  <Pencil className="size-4" />
                </button>
                <button onClick={() => deleteLocation(l.id)} className="rounded-md p-1.5 hover:bg-secondary hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}

        <button
          onClick={() => start(null)}
          className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="size-6" />
          <span className="text-sm font-medium">Add new location</span>
        </button>
      </div>

      {open && (
        <LocationForm
          editing={editing}
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      )}
    </AdminShell>
  );
}
