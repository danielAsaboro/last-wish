import { handlePolicyRequest } from "@/lib/ai/policy-route";

export async function POST(request: Request) {
  return handlePolicyRequest(request);
}
