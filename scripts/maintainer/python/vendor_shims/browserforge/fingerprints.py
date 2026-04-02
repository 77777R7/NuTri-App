class Fingerprint(dict):
    pass


class FingerprintGenerator:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def generate(self):
        return Fingerprint(
            {
                "browser": "chrome",
                "device": "desktop",
            },
        )
