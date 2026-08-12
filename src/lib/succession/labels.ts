import { z } from "zod";

import type { Address } from "./types";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const labelsSchema = z.record(z.string().regex(addressPattern), z.string().trim().min(1).max(60));

export type BeneficiaryLabels = Record<string, string>;

export function parseBeneficiaryLabels(raw: string | null): BeneficiaryLabels {
  if (!raw) return {};
  try {
    const parsed = labelsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    return Object.fromEntries(Object.entries(parsed.data).map(([address, label]) => [address.toLowerCase(), label]));
  } catch {
    return {};
  }
}

export function mergeBeneficiaryLabels<T extends { address: Address }>(beneficiaries: T[], labels: BeneficiaryLabels): Array<T & { label: string }> {
  const normalized = Object.fromEntries(Object.entries(labels).map(([address, label]) => [address.toLowerCase(), label]));
  return beneficiaries.map((beneficiary, index) => ({
    ...beneficiary,
    label: normalized[beneficiary.address.toLowerCase()] ?? `Beneficiary ${index + 1}`,
  }));
}

export function labelsFromDraft(beneficiaries: Array<{ address: string; label: string }>): BeneficiaryLabels {
  return Object.fromEntries(beneficiaries.map(({ address, label }) => [address.toLowerCase(), label.trim()]));
}
