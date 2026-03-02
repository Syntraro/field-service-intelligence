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
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client, Job, InsertJob } from "@shared/schema";
import { CommandSeparator } from "@/components/ui/command";
import {
  JobScheduleFields,
  JobScheduleValue,
  createDefaultScheduleValue,
  parseJobToScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { createJobWithSchedule, applyJobSchedule } from "@/lib/jobScheduling";

interface QuickAddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
  editJob?: Job | null;
  onSuccess?: () => void;
}


export function QuickAddJobDialog({ open, onOpenChange, preselectedLocationId, editJob, onSuccess }: QuickAddJobDialogProps) {
  const { toast } = useToast();
  const [locationOpen, setLocationOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const isEditMode = !!editJob;

  const getDefaultFormData = () => ({
    locationId: preselectedLocationId || "",
    summary: "",
    description: "",
  });

  const [formData, setFormData] = useState(getDefaultFormData());
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(
    createDefaultScheduleValue({ unscheduled: true })
  );

  useEffect(() => {
    if (open && editJob) {
      setFormData({
        locationId: editJob.locationId || "",
        summary: editJob.summary || "",
        description: editJob.description || "",
      });
      // Parse existing job schedule
      setScheduleValue(parseJobToScheduleValue(editJob));
    } else if (open && preselectedLocationId) {
      setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
    }
  }, [open, editJob, preselectedLocationId]);

  useEffect(() => {
    if (!open) {
      setFormData(getDefaultFormData());
      setScheduleValue(createDefaultScheduleValue({ unscheduled: true }));
    }
  }, [open]);

  const { data: clientsResponse } = useQuery<{ data: Client[], pagination: any }>({
    queryKey: ["/api/clients"],
    enabled: open,
  });

  const clients = clientsResponse?.data || [];

  const activeLocations = useMemo(() => {
    return clients.filter(c => !c.inactive).sort((a, b) => 
      (a.companyName || "").localeCompare(b.companyName || "")
    );
  }, [clients]);

  const selectedLocation = useMemo(() => {
    return clients.find(c => c.id === formData.locationId);
  }, [clients, formData.locationId]);

  const createJobMutation = useMutation({
    mutationFn: async () => {
      // Use unified scheduling API for job creation
      const result = await createJobWithSchedule(
        {
          locationId: formData.locationId,
          summary: formData.summary.trim(),
          description: formData.description.trim() || null,
          priority: "medium",
        },
        scheduleValue
      );
      if (!result.success) {
        throw new Error(result.error || "Failed to create job");
      }
      return result.job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      // Phase 5.3 G1: dashboard counts stale after job creation
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      toast({
        title: "Job Created",
        description: scheduleValue.unscheduled
          ? "Job has been added to the backlog."
          : "Job has been created and scheduled.",
      });

      const client = clients.find(c => c.id === formData.locationId);
      if (client?.needsDetails) {
        setTimeout(() => {
          toast({
            title: "Reminder",
            description: `Don't forget to complete the details for "${client.companyName}"!`,
          });
        }, 1500);
      }

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
      // First update the job basic info
      const result = await apiRequest(`/api/jobs/${editJob?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });

      // Then apply scheduling changes if needed
      if (editJob?.id) {
        const scheduleResult = await applyJobSchedule(editJob.id, scheduleValue, {
          existingAssignmentId: editJob.scheduledStart ? editJob.id : undefined,
        });
        if (!scheduleResult.success) {
          console.warn("[QuickAddJobDialog] Schedule update warning:", scheduleResult.error);
        }
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // (covered by family-wide ["jobs"] invalidation above)
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });

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

  const quickCreateClientMutation = useMutation({
    mutationFn: async (companyName: string) => {
      return await apiRequest<{ client: Client }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({ companyName }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (result.client?.id) {
        setFormData(prev => ({ ...prev, locationId: result.client.id }));
      }
      setShowQuickCreate(false);
      setQuickCreateName("");
      setLocationOpen(false);
      toast({
        title: "Client Created",
        description: "Client has been quick-created. Remember to fill in details later!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create client",
        variant: "destructive",
      });
    },
  });

  const handleQuickCreateClient = () => {
    if (!quickCreateName.trim()) return;
    quickCreateClientMutation.mutate(quickCreateName.trim());
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    // Validate schedule if not unscheduled
    if (!scheduleValue.unscheduled && !scheduleValue.date) {
      toast({
        title: "Error",
        description: "Please select a date for the scheduled job",
        variant: "destructive",
      });
      return;
    }

    if (isEditMode) {
      // Update existing job
      const jobData: Partial<InsertJob> = {
        locationId: formData.locationId,
        summary: formData.summary.trim(),
        description: formData.description.trim() || null,
        priority: "medium" as any,
      };
      updateJobMutation.mutate(jobData);
    } else {
      // Create new job with scheduling
      createJobMutation.mutate(undefined);
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
                        {selectedLocation.location && ` - ${selectedLocation.location}`}
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
                        <CommandItem
                          onSelect={() => setShowQuickCreate(true)}
                          data-testid="option-quick-create-client"
                          className="text-primary"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          <span>Add New Client...</span>
                        </CommandItem>
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup heading="Existing Clients">
                        {activeLocations.map(location => (
                          <CommandItem
                            key={location.id}
                            value={`${location.companyName} ${location.location || ""}`}
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
                              {location.location && (
                                <span className="text-xs text-muted-foreground">{location.location}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                  {showQuickCreate && (
                    <div className="p-3 border-t">
                      <div className="flex gap-2">
                        <Input
                          value={quickCreateName}
                          onChange={(e) => setQuickCreateName(e.target.value)}
                          placeholder="Enter client name..."
                          data-testid="input-quick-create-name"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleQuickCreateClient();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleQuickCreateClient}
                          disabled={!quickCreateName.trim() || quickCreateClientMutation.isPending}
                          data-testid="btn-quick-create-submit"
                        >
                          {quickCreateClientMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Add"
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShowQuickCreate(false);
                            setQuickCreateName("");
                          }}
                          data-testid="btn-quick-create-cancel"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
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

            {/* Scheduling Section */}
            <div className="col-span-2 border rounded-lg p-4 bg-muted/20">
              <Label className="text-base font-medium mb-3 block">Scheduling</Label>
              <JobScheduleFields
                value={scheduleValue}
                onChange={setScheduleValue}
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