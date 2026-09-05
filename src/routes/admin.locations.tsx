import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, MapPin, Pencil, Trash2, Users } from "lucide-react";
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

function LocationForm({ editing, onClose }: { editing: LocationItem | null; onClose: () => void }) {
  const { addLocation, updateLocation } = useApi();
  const [name, setName] = useState(editing?.name ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [latitude, setLatitude] = useState(editing?.latitude != null ? String(editing.latitude) : "");
  const [longitude, setLongitude] = useState(editing?.longitude != null ? String(editing.longitude) : "");
  const [radiusMeters, setRadiusMeters] = useState(String(editing?.radiusMeters ?? 200));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const geo = {
      latitude: latitude !== "" ? Number(latitude) : null,
      longitude: longitude !== "" ? Number(longitude) : null,
      radiusMeters: radiusMeters !== "" ? Number(radiusMeters) : 200,
    };
    if (editing) updateLocation(editing.id, { name, address, ...geo });
    else addLocation(name, address, geo);
    onClose();
  };

  return (
    <Modal
      title={editing ? "Edit location" : "Add location"}
      description="Locations feed the worker check-in dropdown. Set GPS coordinates to enable geofenced check-in."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Location name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Camden Site" />
        </Field>
        <Field label="Address">
          <input required value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="24 Camden High St, London" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Latitude" hint="e.g. 51.5072">
            <input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} className={inputCls} placeholder="51.5072" />
          </Field>
          <Field label="Longitude" hint="e.g. -0.1276">
            <input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} className={inputCls} placeholder="-0.1276" />
          </Field>
          <Field label="Radius (m)" hint="Allowed distance">
            <input type="number" min="1" value={radiusMeters} onChange={(e) => setRadiusMeters(e.target.value)} className={inputCls} placeholder="200" />
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
