import json
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from worker.adapter import DataAdapter
from worker.gcs_io import StorageIO


@pytest.fixture
def adapter():
    return DataAdapter(features_config_path="config/features.json")


def test_file_extraction_csv(adapter, tmp_path):
    csv_file = tmp_path / "raw_leads.csv"
    df_raw = pd.DataFrame({
        "ma_ho_so": ["HS001", "HS002"],
        "nam_sinh": [1990, 1985],
        "luong_thang": [2500, 4000],
        "tinh_trang_nha_o": ["Thuê nhà", "Nhà riêng"],
    })
    df_raw.to_csv(csv_file, index=False)

    df_read = adapter.extract_from_file(csv_file)
    assert len(df_read) == 2
    assert "ma_ho_so" in df_read.columns
    assert "nam_sinh" in df_read.columns


def test_file_extraction_excel(adapter, tmp_path):
    excel_file = tmp_path / "raw_crm.xlsx"
    df_raw = pd.DataFrame({
        "customer_id": [101, 102],
        "score": [720, 650],
    })
    df_raw.to_excel(excel_file, index=False, engine="openpyxl")

    df_read = adapter.extract_from_file(excel_file)
    assert len(df_read) == 2
    assert "customer_id" in df_read.columns


def test_transform_with_derivations_and_value_mapping(adapter):
    raw_df = pd.DataFrame({
        "ma_ho_so": ["REC_01", "REC_02"],
        "nam_sinh": [1996, 1988],
        "luong_thang": [3500, 6000],
        "diem_fio": [710, 620],
        "ty_le_no_dti": [0.22, 0.38],
        "so_tien_vay": [12000, 25000],
        "lai_suat": [10.5, 14.2],
        "tinh_trang_nha_o": ["Thuê trọ", "Thế chấp ngân hàng"],
        "muc_dich_vay": ["Tiêu dùng", "Học tập"],
        "tham_nien_lam_viec": [3.5, 8.0],
    })

    clean_df = adapter.transform(raw_df, "config/adapters/crm_sample.yaml")

    # 1. Derivation check: age = 2026 - nam_sinh
    assert clean_df.loc[0, "age"] == 30.0  # 2026 - 1996
    assert clean_df.loc[1, "age"] == 38.0  # 2026 - 1988

    # 2. Derivation check: annual_income = luong_thang * 12
    assert clean_df.loc[0, "annual_income"] == 42000.0  # 3500 * 12
    assert clean_df.loc[1, "annual_income"] == 72000.0  # 6000 * 12

    # 3. Categorical normalization check
    assert clean_df.loc[0, "home_ownership"] == "RENT"
    assert clean_df.loc[1, "home_ownership"] == "MORTGAGE"
    assert clean_df.loc[0, "loan_intent"] == "PERSONAL"
    assert clean_df.loc[1, "loan_intent"] == "EDUCATION"

    # 4. Standard features all present
    with open("config/features.json") as f:
        meta = json.load(f)
    for feat in meta["features"]:
        assert feat["name"] in clean_df.columns

    # 5. Admin metadata present
    assert "request_id" in clean_df.columns
    assert "timestamp" in clean_df.columns
    assert clean_df.loc[0, "request_id"] == "REC_01"


def test_glob_extraction_and_watermark_dedup(adapter, tmp_path):
    data_dir = tmp_path / "incoming"
    data_dir.mkdir()
    wm_file = tmp_path / "watermark.json"

    file1 = data_dir / "batch_01.csv"
    pd.DataFrame({"x": [1, 2]}).to_csv(file1, index=False)

    file2 = data_dir / "batch_02.csv"
    pd.DataFrame({"x": [3, 4]}).to_csv(file2, index=False)

    # First pass: processes both files
    df_pass1, paths1 = adapter.extract_from_glob(str(data_dir / "*.csv"), watermark_file=wm_file)
    assert len(df_pass1) == 4
    assert len(paths1) == 2
    assert wm_file.exists()

    # Second pass: skips both files because hashes match
    df_pass2, paths2 = adapter.extract_from_glob(str(data_dir / "*.csv"), watermark_file=wm_file)
    assert len(df_pass2) == 0
    assert len(paths2) == 0

    # Add third file
    file3 = data_dir / "batch_03.csv"
    pd.DataFrame({"x": [5, 6]}).to_csv(file3, index=False)

    # Third pass: processes only the new file
    df_pass3, paths3 = adapter.extract_from_glob(str(data_dir / "*.csv"), watermark_file=wm_file)
    assert len(df_pass3) == 2
    assert len(paths3) == 1
    assert str(file3) in paths3[0]


def test_database_extraction_sqlite(adapter, tmp_path):
    db_file = tmp_path / "test_bank.db"
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE loan_applications (
            app_id TEXT PRIMARY KEY,
            customer_age REAL,
            yearly_income REAL,
            bureau_score REAL,
            dti REAL,
            requested_amount REAL,
            apr REAL,
            housing_status TEXT,
            purpose TEXT,
            experience_years REAL,
            created_at TEXT,
            status TEXT
        )
    """)

    cursor.executemany("""
        INSERT INTO loan_applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        ("A01", 32, 65000, 710, 0.25, 15000, 11.2, "RENT", "PERSONAL", 5.0, "2026-10-14 02:00:00", "APPROVED"),
        ("A02", 45, 95000, 760, 0.18, 30000, 8.5, "OWN", "VENTURE", 12.0, "2026-10-14 04:00:00", "PROCESSED"),
        ("A03", 24, 35000, 590, 0.42, 5000, 16.0, "RENT", "EDUCATION", 1.0, "2026-10-13 10:00:00", "REJECTED"),
    ])
    conn.commit()
    conn.close()

    query = """
        SELECT 
            app_id as record_id,
            customer_age as age,
            yearly_income as annual_income,
            bureau_score as credit_score,
            dti as debt_to_income_ratio,
            requested_amount as loan_amount,
            apr as interest_rate,
            housing_status as home_ownership,
            purpose as loan_intent,
            experience_years as employment_history_length,
            created_at
        FROM loan_applications
        WHERE created_at >= :window_start AND created_at < :window_end
    """

    params = {
        "window_start": "2026-10-14 00:00:00",
        "window_end": "2026-10-14 06:00:00",
    }

    df_db = adapter.extract_from_db("sqlite", str(db_file), query, params=params)
    assert len(df_db) == 2
    assert set(df_db["record_id"]) == {"A01", "A02"}


def test_score_and_save_partitions(adapter, tmp_path):
    mock_storage = StorageIO(local_mock_dir=str(tmp_path / "mock_storage"))
    custom_adapter = DataAdapter(features_config_path="config/features.json", storage_io=mock_storage)

    raw_df = pd.DataFrame({
        "ma_ho_so": [f"ID_{i}" for i in range(10)],
        "nam_sinh": [1990] * 10,
        "luong_thang": [5000] * 10,
        "diem_fio": [700] * 10,
        "ty_le_no_dti": [0.25] * 10,
        "so_tien_vay": [15000] * 10,
        "lai_suat": [11.0] * 10,
        "tinh_trang_nha_o": ["Thuê nhà"] * 10,
        "muc_dich_vay": ["Tiêu dùng"] * 10,
        "tham_nien_lam_viec": [4.0] * 10,
    })

    clean_df = custom_adapter.transform(raw_df, "config/adapters/crm_sample.yaml")
    scored_df = custom_adapter.score_with_model(clean_df)

    assert "prediction_score" in scored_df.columns
    assert "prediction_label" in scored_df.columns
    assert len(scored_df) == 10

    saved_path = custom_adapter.save_to_partitions(scored_df)
    assert saved_path != ""
    assert "inference_logs" in saved_path

    # Verify partition can be read back
    read_back_df = mock_storage.read_parquet(saved_path)
    assert len(read_back_df) == 10
    assert "age" in read_back_df.columns
