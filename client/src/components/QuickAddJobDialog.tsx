import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client, User, Job, InsertJob } from "@shared/schema";

interface QuickAddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
  editJob?: Job | null;
  onSuccess?: () => void;
}

const JOB_TYPES = [
  { value: "maintenance", label: "Maintenance" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "installation", label: "Installation" },
  { value: "emergency", label: "Emergency" },
];

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
];

export function QuickAddJobDialog({ open, onOpenChange, preselectedLocationId, editJob, onSuccess }: QuickAddJobDialogProps) {
  const { toast } = useToast();
  const [locationOpen, setLocationOpen] = useState(false);
  const isEditMode = !!editJob;
  
  const getDefaultFormData = () => ({
    locationId: preselectedLocationId || "",
    summary: "",
    description: "",
    jobType: "maintenance",
    status: "scheduled",
    scheduledStart: "",
    scheduledEnd: "",
    primaryTechnicianId: "",
    accessInstructions: "",
    billingNotes: "",
  });
  
  const [formData, setFormData] = useState(getDefaultFormData());

  useEffect(() => {
    if (open && editJob) {
      const formatDateForInput = (date: Date | string | null | undefined): string => {
        if (!date) return "";
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 16);
      };
      
      setFormData({
        locationId: editJob.locationId || "",
        summary: editJob.summary || "",
        description: editJob.description || "",
        jobType: editJob.jobType || "maintenance",
        status: editJob.status || "scheduled",
        scheduledStart: formatDateForInput(editJob.scheduledStart),
        scheduledEnd: formatDateForInput(editJob.scheduledEnd),
        primaryTechnicianId: editJob.primaryTechnicianId || "",
        accessInstructions: editJob.accessInstructions || "",
        billingNotes: editJob.billingNotes || "",
      });
    } else if (open && preselectedLocationId) {
      setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
    }
  }, [open, editJob, preselectedLocationId]);

  useEffect(() => {
    if (!open) {
      setFormData(getDefaultFormData());
    }
  }, [open]);

  const { data: clientsResponse } = useQuery<{ data: Client[], pagination: any }>({
    queryKey: ["/api/clients"],
    enabled: open,
  });

  const clients = clientsResponse?.data || [];

  const { data: technicians = [] } = useQuery<User[]>({
    queryKey: ["/api/technicians"],
    enabled: open,
  });

  const activeLocations = useMemo(() => {
    return clients.filter(c => !c.inactive).sort((a, b) => 
      (a.companyName || "").localeCompare(b.companyName || "")
    );
  }, [clients]);

  const selectedLocation = useMemo(() => {
    return clients.find(c => c.id === formData.locationId);
  }, [clients, formData.locationId]);

  const createJobMutation = useMutation({
    mutationFn: async (data: Partial<InsertJob>) => {
      return apiRequest("POST", "/api/jobs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      toast({
        title: "Job Created",
        description: `Job has been created successfully.`,
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create job",
        variant: "destructive",
      });
    },
  });

  const updateJobMutation = useMutation({
    mutationFn: async (data: Partial<InsertJob>) => {
      return apiRequest("PUT", `/api/jobs/${editJob?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", editJob?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      toast({
        title: "Job Updated",
        description: `Job has been updated successfully.`,
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update job",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.locationId) {
      toast({
        title: "Error",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.summary.trim()) {
      toast({
        title: "Error",
        description: "Please enter a job summary",
        variant: "destructive",
      });
      return;
    }

    const jobData: Partial<InsertJob> = {
      locationId: formData.locationId,
      summary: formData.summary.trim(),
      description: formData.description.trim() || null,
      jobType: formData.jobType as any,
      priority: "medium" as any,
      status: formData.status as any,
      scheduledStart: formData.scheduledStart || null,
      scheduledEnd: formData.scheduledEnd || null,
      primaryTechnicianId: formData.primaryTechnicianId || null,
      accessInstructions: formData.accessInstructions.trim() || null,
      billingNotes: formData.billingNotes.trim() || null,
    };

    if (isEditMode) {
      updateJobMutation.mutate(jobData);
    } else {
      createJobMutation.mutate(jobData);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-quick-add-job">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">{isEditMode ? "Edit Job" : "Create New Job"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="location">Location *</Label>
              <Popover open={locationOpen} onOpenChange={setLocationOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={locationOpen}
                    className="w-full justify-between"
                    data-testid="button-select-location"
                  >
                    {selectedLocation ? (
                      <span className="truncate">
                        {selectedLocation.companyName}
                        {selectedLocation.city && ` - ${selectedLocation.city}`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select location...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search locations..." data-testid="input-search-locations" />
                    <CommandList>
                      <CommandEmpty>No locations found.</CommandEmpty>
                      <CommandGroup>
                        {activeLocations.map(location => (
                          <CommandItem
                            key={location.id}
                            value={`${location.companyName} ${location.city || ""}`}
                            onSelect={() => {
                              setFormData(prev => ({ ...prev, locationId: location.id }));
                              setLocationOpen(false);
                            }}
                            data-testid={`option-location-${location.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.locationId === location.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{location.companyName}</span>
                              {location.city && (
                                <span className="text-xs text-muted-foreground">{location.city}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="col-span-2">
              <Label htmlFor="summary">Summary *</Label>
              <Input
                id="summary"
                value={formData.summary}
                onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                placeholder="Brief description of the job"
                data-testid="input-summary"
              />
            </div>

            <div>
              <Label htmlFor="jobType">Job Type</Label>
              <Select
                value={formData.jobType}
                onValueChange={(value) => setFormData(prev => ({ ...prev, jobType: value }))}
              >
                <SelectTrigger data-testid="select-job-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value} data-testid={`option-type-${type.value}`}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value} data-testid={`option-status-${s.value}`}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="technician">Primary Technician</Label>
              <Select
                value={formData.primaryTechnicianId || "none"}
                onValueChange={(value) => setFormData(prev => ({ 
                  ...prev, 
                  primaryTechnicianId: value === "none" ? "" : value 
                }))}
              >
                <SelectTrigger data-testid="select-technician">
                  <SelectValue placeholder="Select technician" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No technician assigned</SelectItem>
                  {technicians.map(tech => (
                    <SelectItem key={tech.id} value={tech.id} data-testid={`option-tech-${tech.id}`}>
                      {tech.firstName && tech.lastName 
                        ? `${tech.firstName} ${tech.lastName}` 
                        : tech.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="scheduledStart">Scheduled Start</Label>
              <Input
                id="scheduledStart"
                type="datetime-local"
                step="900"
                value={formData.scheduledStart}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledStart: e.target.value }))}
                data-testid="input-scheduled-start"
              />
            </div>

            <div>
              <Label htmlFor="scheduledEnd">Scheduled End</Label>
              <Input
                id="scheduledEnd"
                type="datetime-local"
                step="900"
                value={formData.scheduledEnd}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledEnd: e.target.value }))}
                data-testid="input-scheduled-end"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Detailed description of the work to be done"
                rows={3}
                data-testid="input-description"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="accessInstructions">Access Instructions</Label>
              <Textarea
                id="accessInstructions"
                value={formData.accessInstructions}
                onChange={(e) => setFormData(prev => ({ ...prev, accessInstructions: e.target.value }))}
                placeholder="Gate codes, parking info, contact on arrival, etc."
                rows={2}
                data-testid="input-access-instructions"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="billingNotes">Billing Notes</Label>
              <Textarea
                id="billingNotes"
                value={formData.billingNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, billingNotes: e.target.value }))}
                placeholder="Notes for invoicing"
                rows={2}
                data-testid="input-billing-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createJobMutation.isPending || updateJobMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createJobMutation.isPending || updateJobMutation.isPending || !formData.locationId || !formData.summary.trim()}
              data-testid="button-create-job"
            >
              {(createJobMutation.isPending || updateJobMutation.isPending) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditMode ? "Saving..." : "Creating..."}
                </>
              ) : (
                isEditMode ? "Save Changes" : "Create Job"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}