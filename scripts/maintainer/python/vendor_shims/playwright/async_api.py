class _Request:
    def __init__(self):
        self.resource_type = ""
        self.url = ""


class Route:
    def __init__(self):
        self.request = _Request()

    async def abort(self):
        raise ModuleNotFoundError("playwright is not installed in this environment")

    async def continue_(self):
        raise ModuleNotFoundError("playwright is not installed in this environment")


class Response:
    pass


def async_playwright(*args, **kwargs):
    raise ModuleNotFoundError("playwright is not installed in this environment")
