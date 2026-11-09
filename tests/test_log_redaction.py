import logging

from homescreen_hero.core.logging_config import RedactingFormatter, redact_secrets


def test_tokens_are_masked_in_urls_encoded_urls_and_headers():
    assert redact_secrets("GET http://plex:32400/x?a=1&X-Plex-Token=abcDEF123&b=2") == (
        "GET http://plex:32400/x?a=1&X-Plex-Token=REDACTED&b=2"
    )
    assert redact_secrets("url=http%3A%2F%2Fp%2Fc%3Fw%3D4%26X-Plex-Token%3DabcDEF123 rest") == (
        "url=http%3A%2F%2Fp%2Fc%3Fw%3D4%26X-Plex-Token%3DREDACTED rest"
    )
    assert redact_secrets("{'X-Plex-Token': 'abcDEF123', 'Accept': 'json'}") == (
        "{'X-Plex-Token': 'REDACTED', 'Accept': 'json'}"
    )
    assert redact_secrets("nothing secret here") == "nothing secret here"


def test_formatter_masks_messages_and_tracebacks():
    fmt = RedactingFormatter("%(message)s")
    try:
        raise RuntimeError("404 for url: http://p/x?X-Plex-Token=secret1")
    except RuntimeError:
        import sys

        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "Failed %s", ("http://p?X-Plex-Token=secret2",), sys.exc_info())
    out = fmt.format(record)
    assert "secret1" not in out and "secret2" not in out
    assert out.count("REDACTED") >= 2
