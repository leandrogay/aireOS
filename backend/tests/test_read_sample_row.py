import io

import pandas as pd

from app.services.generate_mapping import read_sample_row


def _as_txt_bytes(dataframe):
    buffer = io.BytesIO()
    dataframe.to_csv(buffer, sep="\t", index=False)
    return buffer.getvalue()


def test_takes_the_first_non_blank_value_per_column():
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1", "A2"],
            "Size": [None, "M"],  # first row blank -- should fall through to row 2
        }
    )

    sample = read_sample_row("data.txt", _as_txt_bytes(dataframe))

    assert sample["SKU"] == "A1"
    assert sample["Size"] == "M"


def test_column_with_no_values_at_all_is_left_out():
    dataframe = pd.DataFrame({"SKU": ["A1"], "Empty": [None]})

    sample = read_sample_row("data.txt", _as_txt_bytes(dataframe))

    assert "Empty" not in sample


def test_values_read_back_as_plain_text_not_pandas_floats():
    # A single-column file defeats the .txt delimiter sniffer (too little
    # data to guess from), so this needs at least two columns to exercise
    # realistically -- same requirement every other .txt fixture in this
    # suite already has.
    dataframe = pd.DataFrame({"SKU": ["A1"], "Quantity": [100]})

    sample = read_sample_row("data.txt", _as_txt_bytes(dataframe))

    assert sample["Quantity"] == "100"
