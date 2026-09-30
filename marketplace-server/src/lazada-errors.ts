export type LazadaSafeErrorDetails = Readonly<{
  provider: "LAZADA";
  code: string;
  operation: string;
  apiPath: string;
  retryable: boolean;
  message: string;
  providerCode?: string;
  providerMessage?: string;
  requestId?: string;
  httpStatus?: number;
}>;

export class LazadaHttpError extends Error {
  readonly provider = "LAZADA" as const;
  readonly code: string;
  readonly retryable: boolean;
  readonly operation: string;
  readonly apiPath: string;
  readonly providerCode?: string;
  readonly providerMessage?: string;
  readonly requestId?: string;
  readonly httpStatus?: number;

  constructor(details: LazadaSafeErrorDetails) {
    super(details.message);
    this.name = "LazadaHttpError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.operation = details.operation;
    this.apiPath = details.apiPath;
    this.providerCode = details.providerCode;
    this.providerMessage = details.providerMessage;
    this.requestId = details.requestId;
    this.httpStatus = details.httpStatus;
  }

  toJSON(): object {
    return {
      name: this.name,
      provider: this.provider,
      code: this.code,
      operation: this.operation,
      apiPath: this.apiPath,
      retryable: this.retryable,
      message: this.message,
      ...(this.providerCode ? { providerCode: this.providerCode } : {}),
      ...(this.providerMessage ? { providerMessage: this.providerMessage } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {})
    };
  }
}
