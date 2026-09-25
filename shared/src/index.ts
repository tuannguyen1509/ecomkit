export const PROJECT_NAME = "Ecomkit - Vui Khỏe" as const;
export const TECHNICAL_SLUG = "ecomkit-vuikhoe" as const;
export { normalizeOrderCode } from "./order-code";
export const getBatchProcessingJobId = (batchId: string): string => `batch-${batchId}`;
