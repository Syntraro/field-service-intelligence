import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfToday, addDays, parseISO, isSameDay } from "date-fns";
import { Calendar as CalendarIcon, MapPin, Phone, Mail, Package, Wrench, ChevronRight, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FeedbackDialog from "@/components/FeedbackDialog";

interface Client {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

interface Assignment {
  id: string;
  clientId: string;
  scheduledDate: string;
  completed: boolean;
  year: number;
  month: number;
  day: number | null;
}

interface Part {
  id: string;
  type: string;
  filterType?: string | null;
  beltType?: string | null;
  size?: string | null;
  name?: string | null;
  description?: string | null;
}

interface ClientPart {
  id: string;
  clientId: string;
  partId: string;
  quantity: number;
  part: Part;
}

interface Equipment {
  id: string;
  name: string;
  type?: string | null;
  location?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

interface ClientDetails {
  client: Client;
  parts: ClientPart[];
  equipment: Equipment[];
}

const getPartDisplayName = (part: Part): string => {
  if (part.type === 'filter' && part.filterType && part.size) {
    return `${part.filterType} Filter ${part.size}`;
  } else if (part.type === 'belt' && part.beltType && part.size) {
    return `Belt ${part.beltType}${part.size}`;
  } else if (part.name) {
    return part.name;
  }
  return 'Unknown Part';
};

export default function TechnicianDashboard() {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const today = startOfToday();
  
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  const { data: currentMonthData } = useQuery({
    queryKey: ["/api/calendar", currentYear, currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/calendar?year=${currentYear}&month=${currentMonth}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error("Failed to fetch calendar");
      return res.json();
    },
  });

  const { data: nextMonthData } = useQuery({
    queryKey: ["/api/calendar", nextMonthYear, nextMonth],
    queryFn: async () => {
      const res = await fetch(`/api/calendar?year=${nextMonthYear}&month=${nextMonth}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error("Failed to fetch calendar");
      return res.json();
    },
  });

  const { data: clientDetails, isLoading: isLoadingDetails } = useQuery<ClientDetails>({
    queryKey: ['/api/clients', selectedClient, 'report'],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${selectedClient}/report`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch client details');
      return res.json();
    },
    enabled: !!selectedClient,
  });

  const allAssignments: Assignment[] = [
    ...(currentMonthData?.assignments || []),
    ...(nextMonthData?.assignments || [])
  ];

  const allClients: Client[] = [
    ...(currentMonthData?.clients || []),
    ...(nextMonthData?.clients || [])
  ];

  const uniqueClients = allClients.reduce((acc, client) => {
    if (!acc.find(c => c.id === client.id)) {
      acc.push(client);
    }
    return acc;
  }, [] as Client[]);

  const upcomingDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const assignmentsByDate = upcomingDays.map(date => {
    const dayAssignments = allAssignments
      .filter(a => {
        const scheduledDate = parseISO(a.scheduledDate);
        return isSameDay(scheduledDate, date);
      })
      .map(assignment => {
        const client = uniqueClients.find(c => c.id === assignment.clientId);
        return { assignment, client };
      })
      .filter(item => item.client);

    return {
      date,
      isToday: isSameDay(date, today),
      assignments: dayAssignments
    };
  });

  const todayAssignments = assignmentsByDate[0].assignments;

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="bg-primary text-primary-foreground p-4 md:p-6 sticky top-0 z-10 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Technician Schedule</h1>
            <p className="text-sm opacity-90">{format(today, "EEEE, MMMM d, yyyy")}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFeedbackOpen(true)}
            data-testid="button-feedback"
            aria-label="Open feedback form"
            className="text-primary-foreground"
          >
            <MessageCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-6 md:space-y-8">
        {/* Today's Schedule */}
        <section>
          <h2 className="text-lg md:text-xl font-bold mb-3 md:mb-4 flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Today's Schedule
          </h2>
          {todayAssignments.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No scheduled maintenance for today
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {todayAssignments.map(({ assignment, client }) => (
                <Button
                  key={assignment.id}
                  variant="ghost"
                  className="h-auto w-full p-0 hover:bg-transparent active:bg-transparent"
                  onClick={() => setSelectedClient(client!.id)}
                  data-testid={`today-client-${client!.id}`}
                  aria-label={`View details for ${client!.companyName}`}
                >
                  <Card className="w-full hover-elevate active-elevate-2 touch-manipulation">
                    <CardContent className="p-4 md:p-5">
                      <div className="flex items-start justify-between gap-3 md:gap-4">
                        <div className="flex-1 min-w-0 text-left">
                          <h3 className="font-semibold text-base md:text-lg truncate">
                            {client!.companyName}
                          </h3>
                          {client!.location && (
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {client!.location}
                            </p>
                          )}
                          {client!.address && (
                            <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">{client!.address}</span>
                            </div>
                          )}
                          {assignment.completed && (
                            <Badge variant="default" className="mt-2">
                              Completed
                            </Badge>
                          )}
                        </div>
                        <ChevronRight className="h-5 w-5 md:h-6 md:w-6 flex-shrink-0 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Button>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Schedule */}
        <section>
          <h2 className="text-lg md:text-xl font-bold mb-3 md:mb-4">Upcoming Schedule</h2>
          <div className="space-y-4 md:space-y-5">
            {assignmentsByDate.slice(1).map(({ date, assignments }) => (
              <div key={date.toISOString()}>
                <div className="flex items-center gap-2 mb-2 md:mb-3">
                  <h3 className="font-semibold text-sm md:text-base">
                    {format(date, "EEEE, MMM d")}
                  </h3>
                  <Badge variant="secondary" className="text-xs">{assignments.length}</Badge>
                </div>
                {assignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-4">
                    No scheduled maintenance
                  </p>
                ) : (
                  <div className="space-y-2">
                    {assignments.map(({ assignment, client }) => (
                      <Button
                        key={assignment.id}
                        variant="ghost"
                        className="h-auto w-full p-0 hover:bg-transparent active:bg-transparent"
                        onClick={() => setSelectedClient(client!.id)}
                        data-testid={`upcoming-client-${client!.id}`}
                        aria-label={`View details for ${client!.companyName}`}
                      >
                        <Card className="w-full hover-elevate active-elevate-2 touch-manipulation">
                          <CardContent className="p-3 md:p-4">
                            <div className="flex items-center justify-between gap-3 md:gap-4">
                              <div className="flex-1 min-w-0 text-left">
                                <p className="font-medium text-sm md:text-base truncate">
                                  {client!.companyName}
                                </p>
                                {client!.location && (
                                  <p className="text-xs md:text-sm text-muted-foreground truncate mt-0.5">
                                    {client!.location}
                                  </p>
                                )}
                              </div>
                              <ChevronRight className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Client Details Dialog */}
      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg md:text-xl">Client Details</DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading details...
            </div>
          ) : clientDetails ? (
            <div className="space-y-5 md:space-y-6">
              {/* Client Info */}
              <div>
                <h3 className="font-semibold text-base md:text-lg mb-2">
                  {clientDetails.client.companyName}
                </h3>
                {clientDetails.client.location && (
                  <p className="text-sm md:text-base text-muted-foreground mb-2">
                    {clientDetails.client.location}
                  </p>
                )}
                
                <div className="space-y-2.5 md:space-y-3 mt-4">
                  {clientDetails.client.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div className="text-sm">
                        <p>{clientDetails.client.address}</p>
                        {(clientDetails.client.city || clientDetails.client.province) && (
                          <p>
                            {clientDetails.client.city}
                            {clientDetails.client.city && clientDetails.client.province && ', '}
                            {clientDetails.client.province} {clientDetails.client.postalCode}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {clientDetails.client.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 flex-shrink-0" />
                      <a href={`tel:${clientDetails.client.phone}`} className="text-sm text-primary">
                        {clientDetails.client.phone}
                      </a>
                    </div>
                  )}
                  
                  {clientDetails.client.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <a href={`mailto:${clientDetails.client.email}`} className="text-sm text-primary">
                        {clientDetails.client.email}
                      </a>
                    </div>
                  )}

                  {clientDetails.client.contactName && (
                    <div className="text-sm">
                      <span className="font-medium">Contact: </span>
                      {clientDetails.client.contactName}
                    </div>
                  )}
                </div>

                {clientDetails.client.notes && (
                  <div className="mt-4 p-3 bg-muted rounded-md">
                    <p className="text-sm font-medium mb-1">Notes:</p>
                    <p className="text-sm whitespace-pre-wrap">{clientDetails.client.notes}</p>
                  </div>
                )}
              </div>

              {/* Parts Inventory */}
              <div>
                <h3 className="font-semibold text-sm md:text-base mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4 md:h-5 md:w-5" />
                  Parts Inventory ({clientDetails.parts.length})
                </h3>
                {clientDetails.parts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No parts assigned</p>
                ) : (
                  <div className="space-y-2">
                    {clientDetails.parts.map((clientPart) => (
                      <Card key={clientPart.id}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">
                                {getPartDisplayName(clientPart.part)}
                              </p>
                              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                                {clientPart.part.type}
                              </p>
                            </div>
                            <Badge variant="secondary" className="flex-shrink-0">
                              Qty: {clientPart.quantity}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Equipment */}
              <div>
                <h3 className="font-semibold text-sm md:text-base mb-3 flex items-center gap-2">
                  <Wrench className="h-4 w-4 md:h-5 md:w-5" />
                  Equipment ({clientDetails.equipment.length})
                </h3>
                {clientDetails.equipment.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No equipment tracked</p>
                ) : (
                  <div className="space-y-2">
                    {clientDetails.equipment.map((eq) => (
                      <Card key={eq.id}>
                        <CardContent className="p-3">
                          <p className="font-medium text-sm mb-1">{eq.name}</p>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {eq.type && (
                              <div className="flex gap-2">
                                <span className="font-medium">Type:</span>
                                <span>{eq.type}</span>
                              </div>
                            )}
                            {eq.location && (
                              <div className="flex gap-2">
                                <span className="font-medium">Location:</span>
                                <span>{eq.location}</span>
                              </div>
                            )}
                            {eq.modelNumber && (
                              <div className="flex gap-2">
                                <span className="font-medium">Model:</span>
                                <span>{eq.modelNumber}</span>
                              </div>
                            )}
                            {eq.serialNumber && (
                              <div className="flex gap-2">
                                <span className="font-medium">Serial:</span>
                                <span>{eq.serialNumber}</span>
                              </div>
                            )}
                            {eq.notes && (
                              <div className="mt-2 pt-2 border-t">
                                <p className="font-medium mb-0.5">Notes:</p>
                                <p className="whitespace-pre-wrap">{eq.notes}</p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
