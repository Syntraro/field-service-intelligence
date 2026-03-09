/**
 * PreviewOperationsQueue — global triage/work queue across all clients and locations.
 * Preview-only, mock data, no backend.
 * Route: /preview/operations-queue
 */
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Search, Inbox, AlertCircle, Receipt, Briefcase, FileCheck, CalendarDays,
  MapPin, Clock, User, X, ExternalLink, Wrench,
} from "lucide-react";
import { QUEUE_ITEMS, type QueueItem, type QueueCategory } from "./previewOperationsQueueMockData";
import { MOCK_LOCATIONS } from "./previewClientWorkspaceMockData";

const FILTER_TABS: { value: QueueCategory | "all"; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: Inbox },
  { value: "invoices", label: "Invoices", icon: Receipt },
  { value: "jobs", label: "Jobs", icon: Briefcase },
  { value: "quotes", label: "Quotes", icon: FileCheck },
  { value: "pm", label: "PM", icon: CalendarDays },
];

const URGENCY_COLORS: Record<number, string> = {
  1: "border-l-red-500 bg-red-50/40",
  2: "border-l-emerald-500 bg-emerald-50/30",
  3: "border-l-blue-500 bg-blue-50/30",
  4: "border-l-amber-500 bg-amber-50/30",
};

const URGENCY_DOT: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-emerald-500",
  3: "bg-blue-500",
  4: "bg-amber-500",
};

const CATEGORY_ICON: Record<QueueCategory, React.ElementType> = {
  invoices: Receipt,
  jobs: Briefcase,
  quotes: FileCheck,
  pm: CalendarDays,
};

const LOCATION_TABS = [
  "Overview", "Jobs", "Invoices", "Quotes", "Equipment", "PM", "Parts", "Notes", "Contacts", "Tags",
];

export default function PreviewOperationsQueue() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<QueueCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let items = QUEUE_ITEMS;
    if (filter !== "all") items = items.filter(i => i.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.locationName.toLowerCase().includes(q) ||
        i.clientName.toLowerCase().includes(q) ||
        i.signal.toLowerCase().includes(q),
      );
    }
    return items;
  }, [filter, search]);

  const selected = useMemo(
    () => selectedId ? QUEUE_ITEMS.find(i => i.id === selectedId) ?? null : null,
    [selectedId],
  );

  const selectedLocation = useMemo(
    () => selected ? MOCK_LOCATIONS.find(l => l.id === selected.locationId) ?? null : null,
    [selected],
  );

  const [activeTab, setActiveTab] = useState("Overview");

  // When selection changes, focus the appropriate tab
  const handleSelect = (item: QueueItem) => {
    setSelectedId(prev => prev === item.id ? null : item.id);
    setActiveTab(item.detailTab);
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Preview banner */}
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-xs text-amber-800">
        <AlertCircle className="h-3.5 w-3.5" />
        <span className="font-medium">Preview</span> — Operations Queue (mock data only)
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-5 py-3">
        <h1 className="text-lg font-bold text-foreground">Operations Queue</h1>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {filtered.length} actionable items
        </span>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — queue list */}
        <div className="flex w-[420px] flex-shrink-0 flex-col border-r bg-white">
          {/* Filters */}
          <div className="border-b px-3 py-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search queue..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="flex gap-1">
              {FILTER_TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setFilter(t.value)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    filter === t.value
                      ? "bg-primary text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <t.icon className="h-3 w-3" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Queue rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map(item => {
                const Icon = CATEGORY_ICON[item.category];
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={`w-full text-left border-b border-l-[3px] px-3 py-2.5 transition-colors hover:bg-slate-50 ${
                      URGENCY_COLORS[item.urgency] ?? ""
                    } ${selectedId === item.id ? "bg-blue-50/60 ring-1 ring-inset ring-blue-200" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${URGENCY_DOT[item.urgency]}`} />
                      <span className="truncate text-xs font-semibold text-foreground">{item.locationName}</span>
                      <span className="truncate text-[11px] text-muted-foreground">— {item.clientName}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 pl-4">
                      <Icon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate text-[11px] text-foreground/80">{item.signal}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-2 text-slate-300" />
                <p className="text-xs">No matching items</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — detail pane */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          {selected && selectedLocation ? (
            <>
              {/* Detail header */}
              <div className="flex items-center justify-between border-b px-5 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{selectedLocation.name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.clientName} — {selectedLocation.address}</p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Signal badges */}
              <div className="flex flex-wrap gap-1.5 border-b px-5 py-2">
                {selectedLocation.signals.map((s, i) => (
                  <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    s.color === "red" ? "bg-red-100 text-red-700" :
                    s.color === "orange" ? "bg-amber-100 text-amber-700" :
                    s.color === "blue" ? "bg-blue-100 text-blue-700" :
                    "bg-emerald-100 text-emerald-700"
                  }`}>
                    {s.label}
                  </span>
                ))}
              </div>

              {/* Tabs */}
              <div className="flex border-b px-5 overflow-x-auto">
                {LOCATION_TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`whitespace-nowrap px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      activeTab === tab
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-5">
                <TabContent tab={activeTab} location={selectedLocation} clientName={selected.clientName} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 text-slate-300" />
              <p className="text-sm font-medium">Select an item to view details</p>
              <p className="text-xs mt-1">Click any row in the queue to see location details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders tab content for the selected location */
function TabContent({ tab, location, clientName }: {
  tab: string;
  location: (typeof MOCK_LOCATIONS)[number];
  clientName: string;
}) {
  switch (tab) {
    case "Overview":
      return (
        <div className="space-y-4">
          <Section title="Quick Info">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">Client:</span> {clientName}</div>
              <div><span className="text-muted-foreground">Address:</span> {location.address}</div>
              {location.lastService && <div><span className="text-muted-foreground">Last Service:</span> {location.lastService}</div>}
              {location.pmCadence && <div><span className="text-muted-foreground">PM Cadence:</span> {location.pmCadence}</div>}
            </div>
          </Section>
          {location.equipment.length > 0 && (
            <Section title="Equipment">
              <div className="space-y-1">
                {location.equipment.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Wrench className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{e.name}</span>
                    {e.type && <span className="text-muted-foreground">({e.type})</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
          {location.accessInstructions && (
            <Section title="Access Instructions">
              <p className="text-xs">{location.accessInstructions}</p>
            </Section>
          )}
        </div>
      );

    case "Jobs":
      return location.jobs.length > 0 ? (
        <div className="space-y-2">
          {location.jobs.map((j, i) => (
            <div key={i} className="flex items-center justify-between rounded border p-3">
              <div>
                <span className="text-xs font-semibold">#{j.number}</span>
                <span className="ml-2 text-xs">{j.title}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                j.status === "In Progress" ? "bg-emerald-100 text-emerald-700" :
                j.status === "Scheduled" ? "bg-blue-100 text-blue-700" :
                "bg-slate-100 text-slate-600"
              }`}>{j.status}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No active jobs" />;

    case "Invoices":
      return location.invoices.length > 0 ? (
        <div className="space-y-2">
          {location.invoices.map((inv, i) => (
            <div key={i} className="flex items-center justify-between rounded border p-3">
              <div>
                <span className="text-xs font-semibold">#{inv.number}</span>
                <span className="ml-2 text-xs">${inv.amount.toLocaleString()}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                inv.status === "overdue" ? "bg-red-100 text-red-700" :
                inv.status === "sent" ? "bg-blue-100 text-blue-700" :
                inv.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                "bg-slate-100 text-slate-600"
              }`}>{inv.status}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No invoices" />;

    case "Quotes":
      return location.quotes.length > 0 ? (
        <div className="space-y-2">
          {location.quotes.map((q, i) => (
            <div key={i} className="flex items-center justify-between rounded border p-3">
              <div>
                <span className="text-xs font-semibold">#{q.number}</span>
                <span className="ml-2 text-xs">${q.amount.toLocaleString()}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                q.status === "pending" ? "bg-amber-100 text-amber-700" :
                q.status === "unapproved" ? "bg-blue-100 text-blue-700" :
                "bg-emerald-100 text-emerald-700"
              }`}>{q.status}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No quotes" />;

    case "Equipment":
      return location.equipment.length > 0 ? (
        <div className="space-y-2">
          {location.equipment.map((e, i) => (
            <div key={i} className="flex items-center justify-between rounded border p-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{e.name}</span>
                {e.type && <span className="text-[11px] text-muted-foreground">{e.type}</span>}
              </div>
              <span className="text-[11px] text-muted-foreground">Last: {e.lastService}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No equipment" />;

    case "PM":
      return location.pmSchedule ? (
        <div className="rounded border p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold">{location.pmSchedule}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Next due: <span className="font-medium text-foreground">{location.pmNextDue}</span>
          </div>
          {location.pmCadence && (
            <div className="text-xs text-muted-foreground">Cadence: {location.pmCadence}</div>
          )}
        </div>
      ) : <EmptyTab label="No PM schedule" />;

    case "Parts":
      return location.parts.length > 0 ? (
        <div className="space-y-2">
          {location.parts.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded border p-3">
              <span className="text-xs">{p.name}</span>
              <span className="text-xs text-muted-foreground">Qty: {p.qty}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No parts" />;

    case "Notes":
      return location.notes.length > 0 ? (
        <div className="space-y-2">
          {location.notes.map((n, i) => (
            <div key={i} className="rounded border p-3 text-xs">{n}</div>
          ))}
        </div>
      ) : <EmptyTab label="No notes" />;

    case "Contacts":
      return location.contacts.length > 0 ? (
        <div className="space-y-2">
          {location.contacts.map((c, i) => (
            <div key={i} className="rounded border p-3">
              <p className="text-xs font-semibold">{c.name}</p>
              <p className="text-[11px] text-muted-foreground">{c.role}</p>
              <p className="text-[11px] text-muted-foreground">{c.phone}</p>
            </div>
          ))}
        </div>
      ) : <EmptyTab label="No contacts" />;

    case "Tags":
      return location.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {location.tags.map((t, i) => (
            <span key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{t}</span>
          ))}
        </div>
      ) : <EmptyTab label="No tags" />;

    default:
      return <EmptyTab label="Coming soon" />;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">{label}</div>
  );
}
