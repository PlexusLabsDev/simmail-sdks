"""Errors: one base class, and a subclass per kind of failure."""

from typing import Any, Optional

__all__ = [
    "SimmailError", "ValidationError", "AuthError", "PlanLimitError", "ForbiddenError", "NotFoundError",
    "WaitTimeoutError", "ConflictError", "UnexpectedEmailError", "IdempotencyError", "RateLimitedError", "error_for",
]


class SimmailError(Exception):
    """A failed call: the HTTP status and the server's message.

    ``code`` (an ErrorCode), ``request_id``, ``field``, ``allowed``,
    ``near_misses``, ``matched`` and ``waited_ms`` are set when the server
    sends them; ``body`` is the whole answer. Catch it for every failure; the
    subclasses say which kind.
    """

    def __init__(self, status: int, message: str, body: Any = None, request_id: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.body = body
        b = body if isinstance(body, dict) else {}
        self.code: Optional[str] = b.get("code")
        self.request_id: Optional[str] = b.get("request_id") or request_id
        self.field: Optional[str] = b.get("field")
        self.allowed: Any = b.get("allowed")
        self.near_misses: Optional[list] = b.get("near_misses")
        self.matched: Optional[str] = b.get("matched")
        self.waited_ms: Optional[int] = b.get("waited_ms")


class ValidationError(SimmailError):
    """400: the request was not valid (bad_request, invalid_value, invalid_regex); ``field`` and ``allowed`` say what."""


class AuthError(SimmailError):
    """401: no key, or a key that does not work."""


class PlanLimitError(SimmailError):
    """402: your plan does not include this, or its limit is reached."""


class ForbiddenError(SimmailError):
    """403: your role or key may not do this."""


class NotFoundError(SimmailError):
    """404: there is no such thing."""


class WaitTimeoutError(SimmailError):
    """408: a wait ended with nothing matching; ``near_misses`` lists what almost matched (and why each did not),
    ``messages`` what a thread had."""

    messages: Optional[list] = None


class ConflictError(SimmailError):
    """409: a conflict, such as a person who decided not to reply (fast waits)."""


class UnexpectedEmailError(ConflictError):
    """409: expect_no_email saw an email; ``email`` is that Message."""

    email: Any = None


class IdempotencyError(SimmailError):
    """422: an Idempotency-Key was used before for a different request."""


class RateLimitedError(SimmailError):
    """429: too many requests; ``retry_after`` is in seconds, when the server says."""

    def __init__(self, status: int, message: str, body: Any = None, request_id: Optional[str] = None,
                 retry_after: Optional[float] = None):
        super().__init__(status, message, body, request_id)
        self.retry_after = retry_after


_BY_CODE = {
    "bad_request": ValidationError, "invalid_value": ValidationError, "invalid_regex": ValidationError, "unauthorized": AuthError,
    "not_in_plan": PlanLimitError, "forbidden": ForbiddenError, "not_found": NotFoundError, "timeout": WaitTimeoutError,
    "wait_timeout": WaitTimeoutError, "conflict": ConflictError, "unexpected_email": UnexpectedEmailError,
    "idempotency_mismatch": IdempotencyError, "rate_limited": RateLimitedError,
}
_BY_STATUS = {400: ValidationError, 401: AuthError, 402: PlanLimitError, 403: ForbiddenError, 404: NotFoundError,
              408: WaitTimeoutError, 409: ConflictError, 429: RateLimitedError}


def error_for(status: int, message: str, body: Any = None, retry_after: Optional[float] = None,
              request_id: Optional[str] = None) -> SimmailError:
    """The error for a failed answer: by its code, else by its status."""
    code = body.get("code") if isinstance(body, dict) else None
    cls = _BY_CODE.get(code) or _BY_STATUS.get(status, SimmailError)
    if cls is RateLimitedError:
        return RateLimitedError(status, message, body, request_id, retry_after)
    return cls(status, message, body, request_id)
