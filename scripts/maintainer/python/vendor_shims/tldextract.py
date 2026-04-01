from urllib.parse import urlparse


class _Result:
    def __init__(self, domain):
        self.domain = domain


def extract(url):
    hostname = (urlparse(url).hostname or "").lower()
    parts = [part for part in hostname.split(".") if part]
    if len(parts) >= 2:
        return _Result(parts[-2])
    if parts:
        return _Result(parts[0])
    return _Result("")
