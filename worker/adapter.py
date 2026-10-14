import argparse
import glob
import hashlib
import io
import json
import logging
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd
import yaml

from worker.gcs_io import StorageIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker.adapter")


class DataAdapter:
    """
    Multi-source data ingestion, schema harmonization, and transformation adapter.
    Translates raw data from files, databases, or in-memory streams into the canonical
    schema required by the drift monitoring engine and machine learning models.
    """

    def __init__(
        self,
        features_config_path: str = "config/features.json",
        storage_io: Optional[StorageIO] = None,
    ):
        self.features_config_path = features_config_path
        self.features_meta = self._load_features_meta(features_config_path)
        self.storage_io = storage_io or StorageIO()

    def _load_features_meta(self, path: str) -> Dict[str, Any]:
        p = Path(path)
        if not p.exists():
            logger.warning("Features config path %s not found. Proceeding with empty meta.", path)
            return {"features": []}
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)

    # =========================================================================
    # 1. EXTRACTION LAYER
    # =========================================================================

    def extract_from_file(self, file_path: Union[str, Path], format_type: Optional[str] = None) -> pd.DataFrame:
        """Extracts raw DataFrame from a single file based on format or extension."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Source file not found: {file_path}")

        fmt = (format_type or path.suffix.lstrip(".")).lower()
        logger.info("Extracting data from file: %s (format: %s)", path.name, fmt)

        if fmt in ["csv", "tsv", "txt"]:
            # Try comma, then semicolon, then tab with robust encodings
            for sep in [",", ";", "\t"]:
                for enc in ["utf-8", "utf-8-sig", "latin1"]:
                    try:
                        df = pd.read_csv(path, sep=sep, encoding=enc)
                        if df.shape[1] > 1:
                            return df
                    except Exception:
                        continue
            # Fallback default read
            return pd.read_csv(path)

        elif fmt in ["xlsx", "xls"]:
            return pd.read_excel(path)

        elif fmt == "parquet":
            return pd.read_parquet(path)

        elif fmt in ["json", "jsonl", "ndjson"]:
            try:
                return pd.read_json(path, lines=True)
            except Exception:
                return pd.read_json(path)

        else:
            raise ValueError(f"Unsupported file format: {fmt} for {file_path}")

    def extract_from_bytes(self, data_bytes: bytes, filename: str) -> pd.DataFrame:
        """Extracts DataFrame from raw bytes in memory (e.g. Web UI upload or API)."""
        fmt = Path(filename).suffix.lstrip(".").lower()
        bio = io.BytesIO(data_bytes)

        if fmt in ["csv", "tsv", "txt"]:
            try:
                return pd.read_csv(bio)
            except Exception:
                bio.seek(0)
                return pd.read_csv(bio, sep=";")
        elif fmt in ["xlsx", "xls"]:
            return pd.read_excel(bio)
        elif fmt == "parquet":
            return pd.read_parquet(bio)
        elif fmt in ["json", "jsonl", "ndjson"]:
            try:
                return pd.read_json(bio, lines=True)
            except Exception:
                bio.seek(0)
                return pd.read_json(bio)
        else:
            raise ValueError(f"Unsupported uploaded file format: {fmt}")

    def extract_from_glob(
        self,
        pattern: str,
        watermark_file: Optional[Union[str, Path]] = None,
    ) -> Tuple[pd.DataFrame, List[str]]:
        """
        Discovers files matching glob pattern, deduplicates using state watermark,
        extracts data, and merges into a single batch DataFrame.
        """
        matched_files = sorted(glob.glob(pattern, recursive=True))
        if not matched_files:
            logger.info("No files matched pattern: %s", pattern)
            return pd.DataFrame(), []

        # Load watermark state if provided
        watermark_data = {}
        wm_path = Path(watermark_file) if watermark_file else None
        if wm_path and wm_path.exists():
            try:
                with open(wm_path, "r", encoding="utf-8") as f:
                    watermark_data = json.load(f)
            except Exception as e:
                logger.warning("Could not read watermark file %s: %s", watermark_file, e)

        files_to_process = []
        for fpath in matched_files:
            # Compute hash to detect changes/re-processing
            try:
                with open(fpath, "rb") as f:
                    f_hash = hashlib.md5(f.read()).hexdigest()
            except Exception:
                f_hash = str(os.path.getmtime(fpath))

            if fpath in watermark_data and watermark_data[fpath].get("hash") == f_hash:
                logger.debug("Skipping already processed file: %s", fpath)
                continue

            files_to_process.append((fpath, f_hash))

        if not files_to_process:
            logger.info("All %d matched files have already been processed according to watermark.", len(matched_files))
            return pd.DataFrame(), []

        logger.info("Processing %d new/updated files out of %d matched", len(files_to_process), len(matched_files))
        dfs = []
        processed_paths = []

        for fpath, f_hash in files_to_process:
            try:
                sub_df = self.extract_from_file(fpath)
                if not sub_df.empty:
                    dfs.append(sub_df)
                    processed_paths.append(fpath)
                    watermark_data[fpath] = {
                        "hash": f_hash,
                        "processed_at": datetime.now(timezone.utc).isoformat(),
                        "row_count": len(sub_df),
                    }
            except Exception as e:
                logger.error("Failed to read file %s: %s", fpath, e)

        # Save updated watermark
        if wm_path:
            wm_path.parent.mkdir(parents=True, exist_ok=True)
            with open(wm_path, "w", encoding="utf-8") as f:
                json.dump(watermark_data, f, indent=2)

        if not dfs:
            return pd.DataFrame(), []

        combined_df = pd.concat(dfs, ignore_index=True)
        logger.info("Successfully concatenated %d records from %d files", len(combined_df), len(dfs))
        return combined_df, processed_paths

    def extract_from_db(
        self,
        db_type: str,
        connection_string: str,
        query: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> pd.DataFrame:
        """Extracts DataFrame from a database using parameterized query windowing."""
        logger.info("Querying database (%s) with parameterized window", db_type)
        params = params or {}

        if db_type == "sqlite":
            conn = sqlite3.connect(connection_string)
            try:
                # Replace :named params with sqlite ? or use named dictionary binding
                df = pd.read_sql_query(query, conn, params=params)
                return df
            finally:
                conn.close()

        elif db_type in ["postgres", "postgresql"]:
            try:
                import psycopg2
                conn = psycopg2.connect(connection_string)
                try:
                    df = pd.read_sql_query(query, conn, params=params)
                    return df
                finally:
                    conn.close()
            except ImportError:
                raise ImportError("psycopg2 is required for PostgreSQL connections.")

        else:
            raise ValueError(f"Unsupported db_type: {db_type}")

    # =========================================================================
    # 2. TRANSFORMATION & HARMONIZATION LAYER
    # =========================================================================

    def transform(
        self,
        df_raw: pd.DataFrame,
        mapping_config: Union[str, Path, Dict[str, Any]],
    ) -> pd.DataFrame:
        """
        Transforms raw DataFrame into canonical schema:
        1. Renames columns according to column_mapping.
        2. Evaluates derivations for calculated/derived features.
        3. Normalizes categorical values according to value_mappings.
        4. Applies default values for missing or null features.
        5. Enforces types specified in config/features.json.
        """
        if df_raw.empty:
            return df_raw.copy()

        df = df_raw.copy()
        config = self._load_mapping_config(mapping_config)

        # 1. Rename columns
        col_map = config.get("column_mapping", {})
        if col_map:
            df = df.rename(columns=col_map)

        # 2. Compute derivations (safe column arithmetic / expressions)
        derivations = config.get("derivations", {})
        for target_col, expr in derivations.items():
            try:
                df[target_col] = df.eval(expr)
                logger.debug("Computed derivation for %s: %s", target_col, expr)
            except Exception as e:
                logger.warning("Failed to evaluate derivation %s = %s: %s", target_col, expr, e)

        # 3. Categorical value mapping
        val_maps = config.get("value_mappings", {})
        for col, mapping in val_maps.items():
            if col in df.columns:
                def _map_val(val):
                    if pd.isna(val):
                        return val
                    # Match exact, string, or stripped string
                    if val in mapping:
                        return mapping[val]
                    s_val = str(val).strip()
                    if s_val in mapping:
                        return mapping[s_val]
                    return val

                df[col] = df[col].map(_map_val)

        # 4. Defaults for missing or null columns
        defaults = config.get("defaults", {})
        for col, def_val in defaults.items():
            if col not in df.columns:
                df[col] = def_val
            else:
                df[col] = df[col].fillna(def_val)

        # 5. Type Coercion & Schema Alignment with config/features.json
        expected_features = self.features_meta.get("features", [])
        for feat in expected_features:
            fname = feat["name"]
            ftype = feat.get("type", "numerical")

            if fname not in df.columns:
                if ftype == "numerical":
                    df[fname] = 0.0
                else:
                    df[fname] = "UNKNOWN"

            if ftype == "numerical":
                df[fname] = pd.to_numeric(df[fname], errors="coerce").fillna(0.0).astype(float)
            elif ftype == "categorical":
                df[fname] = df[fname].astype(str)

        # 6. Ensure administrative tracking columns
        if "request_id" not in df.columns and "record_id" in df.columns:
            df["request_id"] = df["record_id"].astype(str)
        elif "request_id" not in df.columns:
            df["request_id"] = [f"ingest_{uuid.uuid4().hex[:10]}" for _ in range(len(df))]

        if "timestamp" not in df.columns:
            now_iso = datetime.now(timezone.utc).isoformat()
            df["timestamp"] = now_iso

        source_name = config.get("source_name", "adapter_ingest")
        df["source_id"] = source_name

        # 7. Drop intermediate columns starting with underscore
        temp_cols = [c for c in df.columns if c.startswith("_")]
        if temp_cols:
            df = df.drop(columns=temp_cols)

        # Reorder columns: tracking first, then standard features
        std_col_names = [f["name"] for f in expected_features]
        extra_cols = [c for c in df.columns if c not in std_col_names and c not in ["request_id", "timestamp", "source_id", "prediction_score", "prediction_label"]]
        ordered_cols = ["request_id", "timestamp", "source_id"] + std_col_names
        for c in ["prediction_score", "prediction_label"]:
            if c in df.columns:
                ordered_cols.append(c)
        ordered_cols.extend(extra_cols)

        final_cols = [c for c in ordered_cols if c in df.columns]
        logger.info("Transformed %d records into canonical format (%d features)", len(df), len(std_col_names))
        return df[final_cols]

    def _load_mapping_config(self, cfg: Union[str, Path, Dict[str, Any]]) -> Dict[str, Any]:
        if isinstance(cfg, dict):
            return cfg
        p = Path(cfg)
        if not p.exists():
            raise FileNotFoundError(f"Mapping configuration not found: {cfg}")
        with open(p, "r", encoding="utf-8") as f:
            if p.suffix in [".yaml", ".yml"]:
                return yaml.safe_load(f)
            return json.load(f)

    # =========================================================================
    # 3. OPTIONAL MODEL SCORING
    # =========================================================================

    def score_with_model(self, df: pd.DataFrame) -> pd.DataFrame:
        """Scores the canonical DataFrame using the active champion model."""
        if df.empty:
            return df

        try:
            from serving.model_loader import ModelLoader
            model_loader = ModelLoader()
            if model_loader.model is None:
                logger.warning("Model loader could not load champion model. Skipping scoring.")
                return df

            scores, labels = model_loader.predict(df)
            df = df.copy()
            df["prediction_score"] = scores
            df["prediction_label"] = labels
            df["model_version"] = model_loader.version
            logger.info("Successfully scored %d records using champion %s", len(df), model_loader.version)
            return df
        except Exception as e:
            logger.warning("Could not execute automatic scoring: %s", e)
            return df

    # =========================================================================
    # 4. PARTITIONED PERSISTENCE
    # =========================================================================

    def save_to_partitions(
        self,
        df: pd.DataFrame,
        prefix: str = "inference_logs",
        batch_time: Optional[datetime] = None,
    ) -> str:
        """Saves canonical DataFrame into standard Hive-partitioned storage."""
        if df.empty:
            logger.warning("DataFrame is empty. Nothing saved to partitions.")
            return ""

        t = batch_time or datetime.now(timezone.utc)
        part_dir = (
            f"{prefix}/year={t.year}/month={t.strftime("%m")}/"
            f"day={t.strftime("%d")}/hour={t.strftime("%H")}"
        )
        batch_id = uuid.uuid4().hex[:8]
        rel_path = f"{part_dir}/ingest_{batch_id}.parquet"

        self.storage_io.write_parquet(rel_path, df)
        logger.info("Persisted %d canonical records to partition: %s", len(df), rel_path)
        return rel_path

    # =========================================================================
    # 5. END-TO-END INGESTION PIPELINE
    # =========================================================================

    def run_ingest(
        self,
        source: str,
        config_path: str,
        score: bool = True,
        watermark_file: Optional[str] = "data/watermarks.json",
    ) -> Dict[str, Any]:
        """End-to-end ingestion pipeline: extract -> transform -> score -> persist."""
        cfg = self._load_mapping_config(config_path)
        db_type = cfg.get("db_type")

        # Extraction
        if db_type in ["sqlite", "postgres", "postgresql"]:
            query = cfg.get("query")
            now_utc = datetime.now(timezone.utc)
            start_utc = now_utc - pd.Timedelta(hours=6)
            params = {
                "window_start": start_utc.isoformat(),
                "window_end": now_utc.isoformat(),
            }
            raw_df = self.extract_from_db(db_type, source, query, params=params)
            processed_sources = [f"db:{db_type}"]
        elif any(c in source for c in ["*", "?", "["]):
            raw_df, processed_sources = self.extract_from_glob(source, watermark_file=watermark_file)
        else:
            raw_df = self.extract_from_file(source)
            processed_sources = [source]

        if raw_df.empty:
            logger.info("Extraction returned 0 records.")
            return {"status": "NO_NEW_DATA", "record_count": 0}

        # Transformation
        clean_df = self.transform(raw_df, cfg)

        # Optional Scoring
        if score:
            clean_df = self.score_with_model(clean_df)

        # Persistence
        saved_path = self.save_to_partitions(clean_df)

        return {
            "status": "SUCCESS",
            "record_count": len(clean_df),
            "sources": processed_sources,
            "saved_partition": saved_path,
        }


def main():
    parser = argparse.ArgumentParser(description="Multi-Source Data Ingestion & Transformation Adapter")
    parser.add_argument("--source", type=str, required=True, help="File path, glob pattern, or DB connection string")
    parser.add_argument("--config", type=str, required=True, help="Path to adapter YAML/JSON config")
    parser.add_argument("--score", action="store_true", default=True, help="Auto-score records with Champion model")
    parser.add_argument("--no-score", dest="score", action="store_false", help="Do not score records")
    parser.add_argument("--watermark", type=str, default="data/watermarks.json", help="Path to watermark state tracking file")

    args = parser.parse_args()
    adapter = DataAdapter()
    result = adapter.run_ingest(
        source=args.source,
        config_path=args.config,
        score=args.score,
        watermark_file=args.watermark,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
