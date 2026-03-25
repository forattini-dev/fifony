export type ApiRouteRequest = {
  param: (name: string) => string | undefined;
  query: (name: string) => string | undefined;
  json: () => Promise<unknown>;
};

export type ApiRouteContext = {
  req: ApiRouteRequest;
  json: (body: unknown, status?: number) => Response;
  body: (body: unknown, status?: number, headers?: Record<string, string>) => Response;
};

export type RouteHandler = (context: ApiRouteContext) => Response | Promise<Response>;

export type RouteRegistrar = {
  get: (path: string, handler: RouteHandler) => void;
  post: (path: string, handler: RouteHandler) => void;
  put: (path: string, handler: RouteHandler) => void;
  patch: (path: string, handler: RouteHandler) => void;
  delete: (path: string, handler: RouteHandler) => void;
};
