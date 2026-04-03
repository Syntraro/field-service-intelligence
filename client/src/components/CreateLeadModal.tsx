/**
 * CreateLeadModal — Create a new lead from the office app.
 * Follows the same pattern as NewQuoteModal (location selector + fields).
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface CreateLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateLeadModal({ open, onOpenChange }: CreateLeadModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [estimatedValue, setEstimatedValue] = useState("");

  // Location search — reuses existing search endpoint
  const { data: locations = [] } = useQuery<{ id: string; companyName: string; location?: string }[]>({
    queryKey: ["/api/clients/search-locations", locationSearch],
    queryFn: async () => {
      if (locationSearch.length < 2) return [];
      const res = await fetch(`/api/clients/search-locations?q=${encodeURIComponent(locationSearch)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: locationSearch.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: selectedLocationId,
          title,
          description: description || null,
          priority,
          estimatedValue: estimatedValue || null,
          sourceType: "office",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead created" });
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create lead", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setLocationSearch("");
    setSelectedLocationId("");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setEstimatedValue("");
  };

  const canSubmit = selectedLocationId && title.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Location search */}
          <div className="space-y-1.5">
            <Label>Client / Location</Label>
            {selectedLocationId ? (
              <div className="flex items-center justify-between px-3 py-2 bg-white border border-[#CBD5E1] rounded-md">
                <span className="text-sm">{locations.find(l => l.id === selectedLocationId)?.companyName || "Selected"}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setSelectedLocationId(""); setLocationSearch(""); }}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8]" />
                  <Input
                    placeholder="Search clients..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {locations.length > 0 && (
                  <div className="border border-[#E2E8F0] rounded-md max-h-40 overflow-y-auto">
                    {locations.map((loc) => (
                      <button
                        key={loc.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#f8fafc] border-b border-[#E2E8F0] last:border-b-0"
                        onClick={() => { setSelectedLocationId(loc.id); setLocationSearch(loc.companyName); }}
                      >
                        <div className="font-medium text-slate-800">{loc.companyName}</div>
                        {loc.location && <div className="text-xs text-slate-500">{loc.location}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compressor replacement needed" maxLength={500} />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details about the opportunity..." rows={3} maxLength={2000} />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Estimated Value */}
          <div className="space-y-1.5">
            <Label>Estimated Value</Label>
            <Input type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} placeholder="0.00" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create Lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
