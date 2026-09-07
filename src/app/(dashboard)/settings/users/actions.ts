"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/generated/prisma/client";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "RM", "DEALER"]),
  managerId: z.string().optional().or(z.literal("")),
  capacity: z.coerce.number().int().positive().optional(),
});

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url"); // 12-char URL-safe temp password
}

export async function createUserAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = createUserSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    managerId: formData.get("managerId"),
    capacity: formData.get("capacity") || undefined,
  });

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new Error("A user with this email already exists");

  const [subscription, seatCount] = await Promise.all([
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId: session.user.organizationId, product: "CRM" } },
    }),
    prisma.user.count({ where: { organizationId: session.user.organizationId } }),
  ]);
  if (subscription?.seats != null && seatCount >= subscription.seats) {
    throw new Error(`Your CRM plan includes ${subscription.seats} seats. Upgrade in Billing to add more team members.`);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.create({
    data: {
      organizationId: session.user.organizationId,
      orgRole: "MEMBER",
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      passwordHash,
      managerId: parsed.managerId || null,
      capacity: parsed.capacity ?? null,
    },
  });

  revalidatePath("/settings/users");
  return { tempPassword };
}

export async function setUserRoleAction(userId: string, role: Role) {
  const session = await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId, organizationId: session.user.organizationId }, data: { role } });

  revalidatePath("/settings/users");
}

export async function setUserManagerAction(userId: string, managerId: string | null) {
  const session = await requireRole(["ADMIN"]);

  if (managerId === userId) throw new Error("A user cannot be their own manager");
  if (managerId) {
    const manager = await prisma.user.findUnique({
      where: { id: managerId, organizationId: session.user.organizationId },
      select: { id: true },
    });
    if (!manager) throw new Error("Manager not found");
  }

  await prisma.user.update({ where: { id: userId, organizationId: session.user.organizationId }, data: { managerId } });

  revalidatePath("/settings/users");
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);

  if (userId === session.user.id && !isActive) {
    throw new Error("You cannot deactivate your own account");
  }

  await prisma.user.update({ where: { id: userId, organizationId: session.user.organizationId }, data: { isActive } });

  revalidatePath("/settings/users");
}

export async function setUserCapacityAction(userId: string, capacity: number | null) {
  const session = await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId, organizationId: session.user.organizationId }, data: { capacity } });

  revalidatePath("/settings/users");
  revalidatePath("/reports");
}

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetUserPasswordAction(userId: string, newPassword: string) {
  const session = await requireRole(["ADMIN"]);

  const parsed = resetPasswordSchema.parse({ newPassword });
  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);

  await prisma.user.update({ where: { id: userId, organizationId: session.user.organizationId }, data: { passwordHash } });

  revalidatePath("/settings/users");
}
