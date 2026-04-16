import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["new", "triaged", "in_progress", "resolved", "wont_fix"];

interface FeedbackRow {
  id: string;
  companyId: string;
  userEmail: string;
  category: string;
  message: string;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  createdAt: string;
  title?: string | null;
}

export default function PlatformFeedbackPage() {
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<FeedbackRow | null>(null);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);

  const { data } = useQuery<{ rows: FeedbackRow[]; total: number }>({
    queryKey: ["/api/platform/feedback", status, q],
    queryFn: () => apiRequest(`/api/platform/feedback?${params.toString()}`),
  });

  return (
    <PlatformLayout>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">Feedback</h2>
        {data && <Badge variant="outline">{data.total}</Badge>}
      </div>
      <div className="mb-4 flex gap-3">
        <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover-elevate" onClick={() => setSelected(r)}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell>{r.userEmail}</TableCell>
                  <TableCell className="max-w-md truncate">{r.title ?? r.message}</TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell>{r.priority ?? "—"}</TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow><TableCell colSpan={6}>No feedback.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected && <FeedbackDetailDialog item={selected} onClose={() => setSelected(null)} />}
    </PlatformLayout>
  );
}

function FeedbackDetailDialog({ item, onClose }: { item: FeedbackRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState(item.status);
  const [priority, setPriority] = useState(item.priority ?? "");
  const [assignedTo, setAssignedTo] = useState(item.assignedTo ?? "");

  const patch = useMutation({
    mutationFn: () => apiRequest(`/api/platform/feedback/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: status || undefined,
        priority: priority || null,
        assignedTo: assignedTo || null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/feedback"] });
      toast({ title: "Feedback updated" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Feedback detail</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p><strong>From:</strong> {item.userEmail}</p>
          <p><strong>Message:</strong></p>
          <div className="rounded border bg-muted/40 p-3 whitespace-pre-wrap">{item.message}</div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority (low / medium / high / critical)</Label>
            <Input value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
          <div>
            <Label>Assignee user id</Label>
            <Input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
          </div>
          <Button onClick={() => patch.mutate()} disabled={patch.isPending} className="w-full">Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
