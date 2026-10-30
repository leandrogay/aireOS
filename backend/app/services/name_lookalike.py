"""Spots a customer or retailer name that is a typo of one that already exists.

Names are free text that become lowercase slugs, and the database only stops
exact repeats, so "sheng_shiong" and "sheng_siong" would both be accepted and
split one customer's sales across two sets of retailers. Pure: no I/O.
"""

from difflib import SequenceMatcher


CHANNEL_SUFFIXES = ("_online", "_offline")
# Short names (giant, nhg) differ by one letter without being typos of each other.
MIN_FAMILY_LENGTH = 6
SIMILARITY = 0.9


def name_family(name: str) -> str:
    """'sheng_siong_online' -> 'sheng_siong'; a customer name is its own family."""
    for suffix in CHANNEL_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def find_lookalike(name: str, existing: list[str]) -> str | None:
    """
    The first existing name whose family is a near miss of this name's family:
    not the same family (a customer's own online and offline retailers share
    one), but nearly the same spelling. None when nothing looks like a typo.
    """
    family = name_family(name)
    if len(family) < MIN_FAMILY_LENGTH:
        return None

    for other in existing:
        other_family = name_family(other)
        if other_family == family or len(other_family) < MIN_FAMILY_LENGTH:
            continue
        if SequenceMatcher(None, family, other_family).ratio() >= SIMILARITY:
            return other

    return None
