export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message = 'No autenticado') => new HttpError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'No tienes permiso para esta acción') => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (message = 'No encontrado') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message: string, code?: string) => new HttpError(409, message, code ?? 'CONFLICT');
