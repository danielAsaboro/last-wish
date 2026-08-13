export function operatorConfig(env = process.env) {
  const publicUrl = new URL(required(env.LASTWISH_PUBLIC_URL, "LASTWISH_PUBLIC_URL"));
  if (publicUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname) || publicUrl.hostname.endsWith(".local")) throw new Error("LASTWISH_PUBLIC_URL must be public HTTPS.");
  const price = required(env.KEEPERHUB_REPORT_PRICE, "KEEPERHUB_REPORT_PRICE");
  if (!/^\d+(?:\.\d{1,6})?$/.test(price) || Number(price) <= 0) throw new Error("KEEPERHUB_REPORT_PRICE must be a positive decimal amount.");
  return { publicUrl: publicUrl.origin, price };
}

export function publicationConfig(env = process.env) {
  const chainId = Number(env.LASTWISH_REPORT_TEST_CHAIN_ID);
  const vault = env.LASTWISH_REPORT_TEST_VAULT;
  if (![84532, 11155111].includes(chainId) || !/^0x[a-fA-F0-9]{40}$/.test(vault ?? "") || /^0x0{40}$/i.test(vault ?? "")) {
    throw new Error("A supported chain and nonzero factory-verified test vault are required for publication.");
  }
  return { chainId, vault };
}

export function mcpAuthorization(env = process.env) {
  const credential = env.KEEPERHUB_MCP_ACCESS_TOKEN || env.KEEPERHUB_API_KEY;
  if (!credential) throw new Error("A KeeperHub MCP credential is required.");
  return `Bearer ${credential}`;
}

export function buildCreateWorkflowArguments(definition) {
  return { ...definition, idempotency_key: "lastwish-vault-integrity-report-v1" };
}

export function buildListingUpdateArguments(workflowId, listing) {
  return {
    workflowId,
    category: listing.category,
    workflowType: listing.workflowType,
    inputSchema: listing.inputSchema,
    outputMapping: listing.outputMapping,
    priceUsdcPerCall: listing.priceUsdcPerCall,
  };
}

export function buildListWorkflowArguments(workflowId, listing) {
  return {
    workflowId,
    slug: listing.slug,
    category: listing.category,
    workflowType: listing.workflowType,
    inputSchema: listing.inputSchema,
    outputMapping: listing.outputMapping,
  };
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
