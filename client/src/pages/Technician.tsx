import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Phone, Mail, MapPin, Package, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

export default function Technician() {
  const { user } = useAuth();
  const [selectedPM, setSelectedPM] = useState<any>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [isSubmittingNotes, setIsSubmittingNotes] = useState(false);

  // Get today's assigned PMs
  const { data: todaysPMs = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/technician/today'],
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  // Fetch assignment details (parts and equipment) for selected PM
  const { data: assignmentDetails } = useQuery<{ parts: any; equipment: any[] }>({
    queryKey: ['/api/technician/assignment', selectedPM?.id, 'details'],
    queryFn: async () => {
      if (!selectedPM?.id) throw new Error('No assignment ID');
      try {
        const response = await fetch(`/api/technician/assignment/${selectedPM.id}/details`, {
          credentials: 'include',
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        return data;
      } catch (error) {
        console.error(`Error fetching details for ${selectedPM.id}:`, error);
        throw error;
      }
    },
    enabled: !!selectedPM?.id,
    staleTime: 5 * 60 * 1000,
  });

  const handleMarkComplete = async () => {
    if (!selectedPM) return;
    
    try {
      setIsSubmittingNotes(true);
      await apiRequest(`/api/calendar/${selectedPM.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true, completionNotes: completionNotes })
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/technician/today'] });
      setSelectedPM(null);
      setCompletionNotes("");
    } catch (error) {
      console.error("Failed to mark complete:", error);
      alert("Failed to mark complete. Please try again.");
    } finally {
      setIsSubmittingNotes(false);
    }
  };

  const handleUncomplete = async (pm: any) => {
    try {
      await apiRequest(`/api/calendar/${pm.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: false, completionNotes: null })
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/technician/today'] });
      setSelectedPM(null);
      setCompletionNotes("");
    } catch (error) {
      console.error("Failed to uncomplete:", error);
      alert("Failed to uncomplete. Please try again.");
    }
  };

  const handleEditNotes = (pm: any) => {
    setSelectedPM(pm);
    setCompletionNotes(pm.assignment.completionNotes || "");
  };

  const handleSaveNotes = async () => {
    if (!selectedPM) return;
    
    try {
      setIsSubmittingNotes(true);
      await apiRequest(`/api/calendar/${selectedPM.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completionNotes: completionNotes })
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/technician/today'] });
      setSelectedPM(null);
      setCompletionNotes("");
    } catch (error) {
      console.error("Failed to save notes:", error);
      alert("Failed to save notes. Please try again.");
    } finally {
      setIsSubmittingNotes(false);
    }
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const technicianName = user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : 'Technician';
  const displayName = `${technicianName}${user?.email ? ` (${user.email})` : ''}`;

  const pendingPMs = todaysPMs.filter((pm: any) => !pm.assignment.completed);
  const completedPMs = todaysPMs.filter((pm: any) => pm.assignment.completed);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="w-full px-3 sm:px-4 py-4 sm:py-6">
          <div className="text-center py-8">Loading your schedule...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="w-full px-3 sm:px-4 py-4 sm:py-6">
        <div className="mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold">Your Schedule</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{displayName}</p>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">{dateStr}</p>
        </div>

        {/* Pending PMs */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-base sm:text-lg font-semibold mb-3 flex items-center gap-2">
            <Circle className="h-4 w-4 sm:h-5 sm:w-5" />
            Today's Jobs ({pendingPMs.length})
          </h2>
          {pendingPMs.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {pendingPMs.map((pm: any) => (
                <Card 
                  key={pm.id} 
                  className="cursor-pointer hover-elevate active-elevate-2"
                  onClick={() => {
                    setSelectedPM(pm);
                    setCompletionNotes("");
                  }}
                  data-testid={`card-pm-${pm.id}`}
                >
                  <CardHeader className="pb-2 sm:pb-3">
                    <CardTitle className="text-base sm:text-lg">{pm.client.companyName}</CardTitle>
                    <p className="text-xs sm:text-sm text-muted-foreground">{pm.client.location}</p>
                  </CardHeader>
                  <CardContent className="space-y-1.5 sm:space-y-2">
                    {pm.client.address && (
                      <div className="flex items-start gap-2 text-xs sm:text-sm">
                        <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 flex-shrink-0" />
                        <span className="break-words">{pm.client.address}, {pm.client.city} {pm.client.province}</span>
                      </div>
                    )}
                    {pm.client.phone && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm">
                        <Phone className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                        <a href={`tel:${pm.client.phone}`} className="hover:underline">{pm.client.phone}</a>
                      </div>
                    )}
                    {pm.client.email && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm">
                        <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                        <a href={`mailto:${pm.client.email}`} className="hover:underline truncate">{pm.client.email}</a>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">No jobs scheduled for today</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Completed PMs */}
        {completedPMs.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <h2 className="text-base sm:text-lg font-semibold mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
              Completed ({completedPMs.length})
            </h2>
            <div className="space-y-2 sm:space-y-3">
              {completedPMs.map((pm: any) => (
                <Card 
                  key={pm.id} 
                  className="opacity-75"
                  data-testid={`card-completed-${pm.id}`}
                >
                  <CardHeader className="pb-2 sm:pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base sm:text-lg truncate">{pm.client.companyName}</CardTitle>
                        <p className="text-xs sm:text-sm text-muted-foreground truncate">{pm.client.location}</p>
                      </div>
                      <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditNotes(pm);
                          }}
                          data-testid={`button-edit-notes-${pm.id}`}
                          className="text-xs sm:text-sm"
                        >
                          Notes
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUncomplete(pm);
                          }}
                          data-testid={`button-uncomplete-${pm.id}`}
                          className="text-xs sm:text-sm"
                        >
                          Reopen
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {pm.assignment.completionNotes && (
                    <CardContent className="pt-0">
                      <div className="text-xs sm:text-sm bg-muted/50 p-2 rounded">
                        <p className="text-muted-foreground break-words">Notes: {pm.assignment.completionNotes}</p>
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Dialog for job details and completion */}
        <Dialog open={!!selectedPM && !selectedPM.assignment.completed} onOpenChange={() => setSelectedPM(null)}>
          <DialogContent className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">{selectedPM?.client?.companyName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 sm:space-y-6">
              <div className="space-y-2 sm:space-y-3">
                <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Location Details
                </h3>
                <div className="text-xs sm:text-sm space-y-1 text-muted-foreground">
                  <p>{selectedPM?.client?.location}</p>
                  <p>{selectedPM?.client?.address}</p>
                  <p>{selectedPM?.client?.city}, {selectedPM?.client?.province} {selectedPM?.client?.postalCode}</p>
                  {selectedPM?.client?.contactName && <p>Contact: {selectedPM.client.contactName}</p>}
                </div>
              </div>

              {assignmentDetails?.parts && Object.keys(assignmentDetails.parts).length > 0 && (
                <div className="space-y-2 sm:space-y-3">
                  <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Parts for this location
                  </h3>
                  <div className="space-y-1.5 sm:space-y-2">
                    {Object.entries(assignmentDetails.parts).map(([partId, data]: [string, any]) => {
                      if (!data || !data.part) return null;
                      return (
                        <div key={partId} className="flex justify-between text-xs sm:text-sm p-2 bg-muted/50 rounded">
                          <span className="break-words flex-1 mr-2">{data.part.name || `${data.part.type} - ${data.part.size}`}</span>
                          <span className="font-semibold flex-shrink-0">Qty: {data.quantity}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {assignmentDetails?.equipment && assignmentDetails.equipment.length > 0 && (
                <div className="space-y-2 sm:space-y-3">
                  <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Equipment
                  </h3>
                  <div className="space-y-1.5 sm:space-y-2">
                    {assignmentDetails.equipment.map((item: any) => (
                      <div key={item.id} className="text-xs sm:text-sm p-2 bg-muted/50 rounded">
                        <p className="font-medium break-words">{item.name}</p>
                        {item.type && <p className="text-muted-foreground">Type: {item.type}</p>}
                        {item.modelNumber && <p className="text-muted-foreground">Model: {item.modelNumber}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 sm:space-y-3">
                <label className="text-xs sm:text-sm font-semibold">Notes for this job (optional)</label>
                <Textarea
                  placeholder="Add any notes about this PM..."
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  className="resize-none text-xs sm:text-sm min-h-[80px]"
                  data-testid="input-completion-notes"
                />
              </div>

              <Button 
                onClick={handleMarkComplete} 
                disabled={isSubmittingNotes}
                className="w-full text-sm sm:text-base"
                data-testid="button-mark-complete"
              >
                {isSubmittingNotes ? "Saving..." : "Mark Complete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog for editing notes on completed jobs */}
        <Dialog open={!!selectedPM && selectedPM.assignment?.completed} onOpenChange={() => setSelectedPM(null)}>
          <DialogContent className="max-w-full sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">Edit Notes - {selectedPM?.client?.companyName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2 sm:space-y-3">
                <label className="text-xs sm:text-sm font-semibold">Completion Notes</label>
                <Textarea
                  placeholder="Edit notes for this completed PM..."
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  className="resize-none text-xs sm:text-sm min-h-[80px]"
                  data-testid="input-edit-completion-notes"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button 
                  onClick={handleSaveNotes} 
                  disabled={isSubmittingNotes}
                  className="flex-1 text-sm sm:text-base"
                  data-testid="button-save-notes"
                >
                  {isSubmittingNotes ? "Saving..." : "Save Notes"}
                </Button>
                <Button 
                  onClick={() => setSelectedPM(null)} 
                  variant="outline"
                  className="flex-1 text-sm sm:text-base"
                  data-testid="button-cancel-notes"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
