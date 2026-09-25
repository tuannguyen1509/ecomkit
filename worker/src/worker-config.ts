export function requireWorkerInternalApiKey(): string {
  const key = process.env.WORKER_INTERNAL_API_KEY;
  if (!key) throw new Error("WORKER_INTERNAL_API_KEY is required.");
  return key;
}
