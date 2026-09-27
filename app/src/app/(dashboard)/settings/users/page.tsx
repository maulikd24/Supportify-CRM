import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewUserDialog } from "./new-user-dialog";
import { UserRowActions } from "./user-row-actions";
import { Panel } from "@/components/dashboard/panel";

export default async function UsersSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const users = await prisma.user.findMany({
    where: { organizationId: session.user.organizationId },
    include: { manager: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <Panel eyebrow="Team" title="Users" action={<><NewUserDialog users={users} /></>}>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{user.role}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.manager?.name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? "default" : "destructive"}>
                    {user.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <UserRowActions
                    user={user}
                    users={users.filter((u) => u.id !== user.id)}
                    isSelf={user.id === session.user.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
