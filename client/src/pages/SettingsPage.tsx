/**
 * SettingsPage — Grouped accordion layout replacing the old SettingsShell sidebar.
 *
 * 2026-04-04: Full rewrite. Single-page dashboard with:
 * - Search filtering across sections/cards
 * - COMPANY section with inline forms (Company Info + Numbering)
 * - All other sections as link cards navigating to existing routes
 * - No nested sidebar; SettingsShell still used by sub-pages
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { insertCompanySettingsSchema, type CompanySettings } from "@shared/schema";
import type { z } from "zod";
import {
  Search,
  Building2,
  Users,
  DollarSign,
  Settings,
  Zap,
  Wrench,
  Database,
  Tag,
  Package,
  FormInput,
  Receipt,
  Plug,
  FileText,
  FileCheck,
  CreditCard,
  Clock,
  Globe,
  Upload,
  Loader2,
  ChevronRight,
  Shield,
  Timer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AddressAutocompleteField from "@/components/ui/AddressAutocompleteField";
import { TIMEZONE_OPTIONS } from "@/lib/regionalConstants";

// ── Types ──

type CompanySettingsFormData = z.infer<typeof insertCompanySettingsSchema>;

// 2026-04-10: NumberingSettings interface REMOVED. The numbering settings UI
// was calling /api/settings/numbering which was never built. Manual job/invoice
// number editing on the detail pages (with self-healing counter advancement)
// is the canonical flow. See the audit in this session for the full rationale.

interface LinkCard {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  buttonLabel?: string;
}

interface SettingsSection {
  id: string;
  title: string;
  icon: React.ElementType;
  /** "inline" renders custom content; "links" renders link cards */
  type: "inline" | "links";
  cards?: LinkCard[];
  /** Compact preview shown when accordion is collapsed */
  preview?: string;
}

// ── Section definitions ──

const SECTIONS: SettingsSection[] = [
  {
    id: "company",
    title: "Company",
    icon: Building2,
    type: "inline",
    preview: "Info, regional, business hours",
    cards: [
      { title: "Company Info", description: "Name, address, contact details", href: "", icon: Building2 },
      { title: "Business Hours", description: "Set operating hours", href: "/settings/business-hours", icon: Clock },
    ],
  },
  {
    id: "team",
    title: "Team",
    icon: Users,
    type: "links",
    preview: "Team management, roles, permissions",
    cards: [
      { title: "Team Management", description: "Manage technicians and staff", href: "/manage-team", icon: Users },
      { title: "Roles & Permissions", description: "Configure access levels", href: "/manage-roles", icon: Shield },
      // Phase 7 (Production Readiness): tenant-side approval surface.
      { title: "Support Access", description: "Approve internal support requests and revoke active sessions", href: "/settings/support-access", icon: Shield },
    ],
  },
  {
    id: "financials",
    title: "Financials",
    icon: DollarSign,
    type: "links",
    preview: "Tax billing, time billing, subscription",
    cards: [
      { title: "Tax & Billing", description: "Configure tax rates and billing rules", href: "/settings/tax-billing", icon: Receipt },
      { title: "Time Billing", description: "Labour rate and billing configuration", href: "/settings/time-billing", icon: Timer },
      { title: "Subscription", description: "Manage billing and subscription", href: "/settings/subscription", icon: CreditCard },
    ],
  },
  {
    id: "system",
    title: "System",
    icon: Settings,
    type: "links",
    preview: "Products, tags, categories, custom fields",
    cards: [
      { title: "Products & Services", description: "Manage your product catalog", href: "/settings/products", icon: Package },
      { title: "Tags", description: "Manage client and location tags", href: "/settings/tags", icon: Tag },
      { title: "Categories", description: "Organize items into categories", href: "/settings/categories", icon: Tag },
      { title: "Custom Fields", description: "Define custom data fields", href: "/settings/custom-fields", icon: FormInput },
    ],
  },
  {
    id: "automation",
    title: "Automation",
    icon: Zap,
    type: "links",
    preview: "Job templates, quote templates, client communication",
    cards: [
      { title: "Job Templates", description: "Reusable job configurations", href: "/settings/job-templates", icon: FileText },
      { title: "Quote Templates", description: "Manage quote templates", href: "/settings/quote-templates", icon: FileCheck },
      // Phase 11 (2026-04-12): customize outbound email templates.
      { title: "Client Communication", description: "Customize invoice / quote / job email templates", href: "/settings/communication", icon: FileText },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    icon: Wrench,
    type: "links",
    preview: "Integrations, QuickBooks Online",
    cards: [
      { title: "Integrations", description: "Connect third-party services", href: "/settings/integrations", icon: Plug },
      { title: "QuickBooks Online", description: "Sync clients, invoices, payments", href: "/settings/integrations/qbo", icon: Plug },
    ],
  },
  {
    id: "data",
    title: "Data",
    icon: Database,
    type: "links",
    preview: "Import clients, jobs, products",
    cards: [
      { title: "Import Clients", description: "Import clients from CSV", href: "/settings/import-clients", icon: Upload },
      { title: "Import Jobs", description: "Import historical jobs from CSV", href: "/settings/import-jobs", icon: Upload },
      { title: "Import Products", description: "Import products and services from CSV", href: "/settings/import-products", icon: Upload },
    ],
  },
];

// ── Link card component ──

function SettingsLinkCard({ card }: { card: LinkCard }) {
  const [, setLocation] = useLocation();
  const Icon = card.icon;
  return (
    <Card
      className="group cursor-pointer shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
      onClick={() => setLocation(card.href)}
    >
      <CardContent className="flex items-center gap-4 py-4">
        <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors">
          <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{card.title}</p>
          <p className="text-xs text-muted-foreground">{card.description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </CardContent>
    </Card>
  );
}

// ── Inline Company Info fields (no individual save button) ──

function CompanyInfoFields({ registerSave }: { registerSave: (fn: () => void) => void }) {
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: settings, isLoading } = useQuery<CompanySettings | null>({
    queryKey: ["/api/company-settings"],
    enabled: Boolean(user?.id),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const form = useForm<CompanySettingsFormData>({
    resolver: zodResolver(insertCompanySettingsSchema),
    defaultValues: {
      companyName: "",
      address: "",
      city: "",
      provinceState: "",
      postalCode: "",
      email: "",
      phone: "",
    },
  });

  useEffect(() => {
    if (settings !== undefined) {
      form.reset({
        companyName: settings?.companyName || "",
        address: settings?.address || "",
        city: settings?.city || "",
        provinceState: settings?.provinceState || "",
        postalCode: settings?.postalCode || "",
        email: settings?.email || "",
        phone: settings?.phone || "",
      });
    }
  }, [settings, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: CompanySettingsFormData) => {
      return await apiRequest("/api/company-settings", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Settings saved", description: "Company info updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save company settings.", variant: "destructive" });
    },
  });

  // Register save callback with parent
  useEffect(() => {
    registerSave(() => {
      form.handleSubmit((data) => updateMutation.mutate(data))();
    });
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4">
        <Form {...form}>
          <div className="space-y-3">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Company Name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} placeholder="Enter company name" className="h-8 text-sm" data-testid="input-company-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <AddressAutocompleteField
              name="address"
              label="Street Address"
              placeholder="123 Main Street"
              data-testid="input-address"
              fieldMapping={{ city: "city", province: "provinceState", postalCode: "postalCode" }}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">City</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="City" className="h-8 text-sm" data-testid="input-city" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="provinceState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Province/State</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="ON" className="h-8 text-sm" data-testid="input-province-state" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="postalCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Postal/Zip Code</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="A1A 1A1" className="h-8 text-sm" data-testid="input-postal-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Email</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} type="email" placeholder="company@example.com" className="h-8 text-sm" data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} type="tel" placeholder="(555) 123-4567" className="h-8 text-sm" data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

// 2026-04-10: NumberingFields component REMOVED. See comment above NumberingSettings.
// Job/invoice numbers are editable inline on their respective detail pages, with
// self-healing counter advancement. No settings UI needed.

// ── Inline Regional Settings fields (no individual save button) ──

const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];
const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour" },
  { value: "24h", label: "24-hour" },
];
const WEEK_START_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
];

interface RegionalSettings {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  weekStartsOn?: string;
}

function RegionalFields({ registerSave }: { registerSave: (fn: () => void) => void }) {
  const { toast } = useToast();
  const [timezone, setTimezone] = useState("America/Toronto");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [timeFormat, setTimeFormat] = useState("12h");
  const [weekStartsOn, setWeekStartsOn] = useState("monday");

  const { data: settings, isLoading } = useQuery<RegionalSettings>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (settings) {
      if (settings.timezone) setTimezone(settings.timezone);
      if (settings.dateFormat) setDateFormat(settings.dateFormat);
      if (settings.timeFormat) setTimeFormat(settings.timeFormat);
      if (settings.weekStartsOn) setWeekStartsOn(settings.weekStartsOn);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<RegionalSettings>) =>
      apiRequest("/api/company-settings", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/company-settings"], (old: any) => ({ ...old, ...data }));
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Regional settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  // Register save callback with parent
  useEffect(() => {
    registerSave(() => {
      updateMutation.mutate({ timezone, dateFormat, timeFormat, weekStartsOn });
    });
  });

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Regional
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-timezone" className="text-xs">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={isLoading}>
              <SelectTrigger id="r-timezone" className="h-8 text-sm" data-testid="select-timezone">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-week-start" className="text-xs">Week Starts On</Label>
            <Select value={weekStartsOn} onValueChange={setWeekStartsOn} disabled={isLoading}>
              <SelectTrigger id="r-week-start" className="h-8 text-sm" data-testid="select-week-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_START_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-date-format" className="text-xs">Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat} disabled={isLoading}>
              <SelectTrigger id="r-date-format" className="h-8 text-sm" data-testid="select-date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-time-format" className="text-xs">Time Format</Label>
            <Select value={timeFormat} onValueChange={setTimeFormat} disabled={isLoading}>
              <SelectTrigger id="r-time-format" className="h-8 text-sm" data-testid="select-time-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ──

const SETTINGS_OPEN_KEY = "settings-open-sections";

function loadOpenSections(): string[] {
  try {
    const stored = sessionStorage.getItem(SETTINGS_OPEN_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveOpenSections(sections: string[]) {
  try { sessionStorage.setItem(SETTINGS_OPEN_KEY, JSON.stringify(sections)); } catch {}
}

export default function SettingsPage() {
  const [search, setSearch] = useState("");
  // Controlled accordion state — persisted in sessionStorage across navigation
  const [openSections, setOpenSections] = useState<string[]>(loadOpenSections);

  const handleAccordionChange = (value: string[]) => {
    setOpenSections(value);
    saveOpenSections(value);
  };

  // Filter sections and cards based on search
  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS;
    const q = search.toLowerCase();
    return SECTIONS.map((section) => {
      const sectionMatch = section.title.toLowerCase().includes(q);
      const filteredCards = section.cards?.filter(
        (c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      );
      if (sectionMatch) return section;
      if (filteredCards && filteredCards.length > 0) return { ...section, cards: filteredCards };
      return null;
    }).filter(Boolean) as SettingsSection[];
  }, [search]);

  // When searching, show all matching sections expanded; otherwise use persisted state
  const accordionValue = search.trim()
    ? filteredSections.map((s) => s.id)
    : openSections;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="settings-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your application preferences</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search settings..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-settings-search"
        />
      </div>

      {/* Accordion sections */}
      {filteredSections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No settings match "{search}"</p>
        </div>
      ) : (
        <Accordion
          type="multiple"
          value={accordionValue}
          onValueChange={search.trim() ? undefined : handleAccordionChange}
          className="space-y-2"
        >
          {filteredSections.map((section) => {
            const Icon = section.icon;
            return (
              <AccordionItem key={section.id} value={section.id} className="border rounded-md px-4 bg-card shadow-sm">
                <AccordionTrigger className="hover:no-underline group">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-base font-semibold">{section.title}</span>
                    {section.preview && (
                      <span className="text-sm text-muted-foreground font-normal truncate hidden sm:inline group-data-[state=open]:hidden">
                        — {section.preview}
                      </span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="bg-muted/40 rounded-b-lg p-4">
                  {section.id === "company" ? (
                    <CompanySectionContent cards={section.cards} search={search} />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {section.cards?.map((card) => (
                        <SettingsLinkCard key={card.href} card={card} />
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

// ── Company section — unified save button for all inline forms ──

function CompanySectionContent({ cards, search }: { cards?: LinkCard[]; search: string }) {
  const q = search.toLowerCase();
  const showCompanyInfo = !q || "company info".includes(q) || "name address contact".includes(q) || "company".includes(q);
  const showRegional = !q || "regional".includes(q) || "timezone".includes(q) || "date format time format week start".includes(q);

  // Save callback refs — each child registers its save fn
  const companyInfoSaveRef = useRef<() => void>(() => {});
  const regionalSaveRef = useRef<() => void>(() => {});

  const registerCompanyInfoSave = useCallback((fn: () => void) => { companyInfoSaveRef.current = fn; }, []);
  const registerRegionalSave = useCallback((fn: () => void) => { regionalSaveRef.current = fn; }, []);

  const [isSaving, setIsSaving] = useState(false);
  const handleSaveAll = () => {
    setIsSaving(true);
    companyInfoSaveRef.current();
    regionalSaveRef.current();
    // Reset after a brief delay to let mutations fire
    setTimeout(() => setIsSaving(false), 1000);
  };

  // Link cards (Business Hours only — Regional is inline)
  const linkCards = (cards || []).filter((c) => c.href);

  return (
    <div className="space-y-3">
      {/* Two-column layout: Company Info left, Regional right */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
        {showCompanyInfo && (
          <div className="lg:col-span-3">
            <CompanyInfoFields registerSave={registerCompanyInfoSave} />
          </div>
        )}
        <div className="lg:col-span-2 space-y-3">
          {showRegional && <RegionalFields registerSave={registerRegionalSave} />}
        </div>
      </div>
      {/* Unified save button */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          {linkCards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {linkCards.map((card) => (
                <SettingsLinkCard key={card.href} card={card} />
              ))}
            </div>
          )}
        </div>
        <Button size="sm" onClick={handleSaveAll} disabled={isSaving} data-testid="button-save-company-all">
          {isSaving ? "Saving..." : "Save All"}
        </Button>
      </div>
    </div>
  );
}
