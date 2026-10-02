import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("uvicorn.error")


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """
    Turn any exception a route doesn't explicitly catch into a normal 500
    JSON response instead of letting it propagate to Starlette's own error
    handling.

    That matters for CORS specifically: Starlette's default error handling
    (ServerErrorMiddleware) sits OUTSIDE CORSMiddleware, so a response it
    builds never passes back through CORSMiddleware and never gets an
    Access-Control-Allow-Origin header. The browser then reports a CORS
    failure instead of the real 500 -- hiding whatever actually broke (an
    expired BigQuery/GCS credential, a missing package, a bad query) behind
    a misleading CORS error in devtools. This middleware is registered
    *before* CORSMiddleware below, which puts it *inside* CORSMiddleware in
    the stack, so a response built here still passes through CORSMiddleware
    on the way out and keeps its CORS headers. The real exception is still
    logged (and echoed in the body) for debugging.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001 - intentionally broad, last resort
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=500,
                content={"detail": f"{type(exc).__name__}: {exc}"},
            )
