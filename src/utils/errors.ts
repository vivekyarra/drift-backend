export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly expose: boolean;

  constructor(
    status: number,
    message: string,
    options?: {
      code?: string;
      expose?: boolean;
    },
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = options?.code;
    this.expose = options?.expose ?? true;
  }
}

export const isHttpError = (value: unknown): value is HttpError =>
  value instanceof HttpError;
