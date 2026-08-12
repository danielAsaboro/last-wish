import type { Address } from "./types";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export type BeneficiaryLabels = Record<string, string>;

export function parseBeneficiaryLabels(raw: string | null): BeneficiaryLabels {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([address, value]) => {
      const label = typeof value === "string" ? value.trim() : "";
      return addressPattern.test(address) && label.length > 0 && label.length <= 60
        ? [[address.toLowerCase(), label]]
        : [];
    }));
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
  return Object.fromEntries(beneficiaries.flatMap(({ address, label }) => {
    const trimmed = label.trim();
    return addressPattern.test(address) && trimmed.length > 0 && trimmed.length <= 60
      ? [[address.toLowerCase(), trimmed]]
      : [];
  }));
}
