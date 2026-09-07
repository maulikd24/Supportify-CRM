import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDefinition } from "@/generated/prisma/client";

/**
 * Renders one form field per org-defined CustomFieldDefinition. Field names are
 * `customFields.<key>` — parse them back out with parseCustomFieldsFromFormData.
 */
export function CustomFieldInputs({
  definitions,
  defaultValues,
}: {
  definitions: CustomFieldDefinition[];
  defaultValues?: Record<string, unknown>;
}) {
  return (
    <>
      {definitions.map((def) => {
        const name = `customFields.${def.key}`;
        const value = defaultValues?.[def.key];
        const required = def.required;

        if (def.fieldType === "BOOLEAN") {
          return (
            <Field key={def.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} value="true" defaultChecked={Boolean(value)} />
                {def.label}
              </label>
            </Field>
          );
        }

        if (def.fieldType === "SELECT") {
          const options = (def.options as string[] | null) ?? [];
          return (
            <Field key={def.id}>
              <FieldLabel htmlFor={name}>{def.label}</FieldLabel>
              <Select name={name} defaultValue={typeof value === "string" ? value : undefined}>
                <SelectTrigger id={name} className="w-full">
                  <SelectValue placeholder={`Select ${def.label.toLowerCase()}`}>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          );
        }

        return (
          <Field key={def.id}>
            <FieldLabel htmlFor={name}>
              {def.label} {required && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id={name}
              name={name}
              type={def.fieldType === "NUMBER" ? "number" : def.fieldType === "DATE" ? "date" : "text"}
              required={required}
              defaultValue={value != null ? String(value) : undefined}
            />
          </Field>
        );
      })}
    </>
  );
}

/** Pulls `customFields.<key>` entries back out of a submitted FormData into a plain object. */
export function parseCustomFieldsFromFormData(
  formData: FormData,
  definitions: { key: string; fieldType: string }[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of definitions) {
    const raw = formData.get(`customFields.${def.key}`);
    if (raw === null) continue;
    if (def.fieldType === "BOOLEAN") {
      result[def.key] = raw === "true";
    } else if (def.fieldType === "NUMBER") {
      result[def.key] = raw === "" ? null : Number(raw);
    } else {
      result[def.key] = String(raw) || null;
    }
  }
  return result;
}
