import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Copy, RotateCcw, Plus, UserCheck, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { EmptyState } from "@/components/ui/empty-state";

export default function TechnicianManagementPage() {
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  const { teamMembers: technicians, isLoading } = useTechniciansDirectory();

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string }) => {
      return await apiRequest("/api/technicians/invite", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({ title: "Invitation sent successfully" });
      form.reset();
      setInviteOpen(false);
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/technicians/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Technician deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/technicians/${id}/reset-password`, { method: "POST" });
    },
    onSuccess: (data) => {
      toast({ title: "Password reset link generated" });
      // Copy to clipboard
      navigator.clipboard.writeText(data.resetLink);
      setCopiedInvite(data.resetLink);
      setTimeout(() => setCopiedInvite(null), 2000);
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const form = useForm({
    defaultValues: { email: "" },
  });

  const handleCopyInvite = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedInvite(text);
    setTimeout(() => setCopiedInvite(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="icon" data-testid="button-back-settings">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-xl font-semibold" data-testid="text-technician-management-title">Team Management</h1>
          </div>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button size="default" data-testid="button-invite-technician">
                <Plus className="h-4 w-4 mr-2" />
                Invite Technician
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Technician</DialogTitle>
                <DialogDescription>Send an invitation link to a new technician</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => inviteMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input placeholder="technician@example.com" type="email" {...field} data-testid="input-invite-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={inviteMutation.isPending} data-testid="button-send-invite">
                    Generate Invite Link
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Loading technicians...</div>
        ) : (
          <>
            {technicians.length === 0 ? (
              <Card>
                <CardContent className="pt-6 pb-6">
                  <EmptyState
                    icon={UserCheck}
                    message="No technicians added yet"
                    action={<Button onClick={() => setInviteOpen(true)}>Invite your first technician</Button>}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {technicians.map((tech) => (
                  <Card key={tech.id} data-testid={`card-technician-${tech.id}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold" data-testid={`text-technician-email-${tech.id}`}>
                            {tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.email}
                          </h3>
                          {(tech.firstName || tech.lastName) && (
                            <p className="text-sm text-muted-foreground">{tech.email}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            Role: {tech.role}{tech.createdAt ? ` • Added: ${new Date(tech.createdAt).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resetPasswordMutation.mutate(tech.id)}
                            data-testid={`button-reset-password-${tech.id}`}
                            disabled={resetPasswordMutation.isPending}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Reset Password
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(tech.id)}
                            data-testid={`button-delete-technician-${tech.id}`}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
