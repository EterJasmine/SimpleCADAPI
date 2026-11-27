"""Service errors shared by the AI boundary and HTTP adapter."""


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 500):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
