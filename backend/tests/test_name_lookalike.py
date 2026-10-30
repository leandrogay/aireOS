from app.services.name_lookalike import find_lookalike, name_family


# ---- name_family ---------------------------------------------------------------


def test_a_channel_suffix_is_dropped_from_the_family():
    assert name_family("sheng_siong_online") == "sheng_siong"
    assert name_family("sheng_siong_offline") == "sheng_siong"
    assert name_family("sheng_siong") == "sheng_siong"


# ---- find_lookalike ------------------------------------------------------------


def test_a_one_letter_misspelling_of_a_customer_is_a_lookalike():
    assert find_lookalike("sheng_shiong_online", ["sheng_siong_online"]) == "sheng_siong_online"
    assert find_lookalike("sheng_shiong", ["sheng_siong"]) == "sheng_siong"


def test_the_same_family_on_another_channel_is_not_a_lookalike():
    assert find_lookalike("sheng_siong_online", ["sheng_siong_offline"]) is None


def test_unrelated_names_are_not_lookalikes():
    existing = ["fairprice_offline", "singhealth_offline", "sheng_siong_online"]

    assert find_lookalike("prime_offline", existing) is None
    assert find_lookalike("singapore_post", existing) is None


def test_short_names_that_differ_by_a_letter_are_left_alone():
    assert find_lookalike("nhs_offline", ["nhg_offline"]) is None
    assert find_lookalike("giant", ["giants"]) is None


def test_no_existing_names_means_no_lookalike():
    assert find_lookalike("sheng_siong", []) is None
