import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pandas as pd

try:
    import pyarrow.parquet as pq
    import pyarrow as pa
    PYARROW_AVAILABLE = True
except ImportError:
    PYARROW_AVAILABLE = False

try:
    from google.cloud import storage
    GCS_CLIENT_AVAILABLE = True
except ImportError:
    GCS_CLIENT_AVAILABLE = False

logger = logging.getLogger("worker.gcs_io")


class StorageIO:
    """
    Unified storage abstraction for reading and writing datasets,
    baselines, and partition logs from GCS or local mock storage.
    """

    def __init__(
        self,
        bucket_name: Optional[str] = None,
        local_mock_dir: Optional[str] = None,
    ):
        self.bucket_name = bucket_name or os.getenv("GCS_BUCKET_NAME", "drift-platform-data")
        self.local_mock_dir = local_mock_dir or os.getenv("GCS_LOCAL_MOCK_DIR", "./data/gcs_mock")

        self.gcs_client = None
        self.bucket = None
        self._init_backend()

    def _init_backend(self):
        use_mock = os.getenv("APP_ENV") == "development" or self.local_mock_dir is not None
        if not use_mock and GCS_CLIENT_AVAILABLE and os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            try:
                self.gcs_client = storage.Client()
                self.bucket = self.gcs_client.bucket(self.bucket_name)
                logger.info("StorageIO connected to GCS bucket: %s", self.bucket_name)
                return
            except Exception as e:
                logger.warning("GCS connection failed (%s). Falling back to local directory.", e)

        Path(self.local_mock_dir).mkdir(parents=True, exist_ok=True)
        logger.info("StorageIO initialized with local directory: %s", self.local_mock_dir)

    def write_json(self, relative_path: str, data: Any):
        """Serialize data to JSON and upload to storage."""
        json_str = json.dumps(data, indent=2, default=str)
        if self.bucket:
            blob = self.bucket.blob(relative_path)
            blob.upload_from_string(json_str, content_type="application/json")
        else:
            dest = Path(self.local_mock_dir) / relative_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(json_str)

    def read_json(self, relative_path: str) -> Optional[Any]:
        """Read and deserialize JSON from storage."""
        try:
            if self.bucket:
                blob = self.bucket.blob(relative_path)
                if not blob.exists():
                    return None
                return json.loads(blob.download_as_text())
            else:
                dest = Path(self.local_mock_dir) / relative_path
                if not dest.exists():
                    return None
                with open(dest, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.error("Error reading JSON from %s: %s", relative_path, e)
            return None

    def write_parquet(self, relative_path: str, df: pd.DataFrame):
        """Write DataFrame to Parquet format in storage."""
        if PYARROW_AVAILABLE:
            buf = io.BytesIO()
            df.to_parquet(buf, engine="pyarrow", index=False)
            data_bytes = buf.getvalue()
        else:
            # Fallback to JSON Lines if pyarrow is missing in offline test runner
            alt_path = relative_path.replace(".parquet", ".jsonl")
            content = df.to_json(orient="records", lines=True).encode("utf-8")
            self._write_raw_bytes(alt_path, content)
            return

        self._write_raw_bytes(relative_path, data_bytes)

    def _write_raw_bytes(self, relative_path: str, data_bytes: bytes):
        if self.bucket:
            blob = self.bucket.blob(relative_path)
            blob.upload_from_string(data_bytes, content_type="application/octet-stream")
        else:
            dest = Path(self.local_mock_dir) / relative_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data_bytes)

    def read_parquet(self, relative_path: str) -> pd.DataFrame:
        """Read Parquet file into DataFrame."""
        if self.bucket:
            blob = self.bucket.blob(relative_path)
            if not blob.exists():
                # check fallback
                blob_json = self.bucket.blob(relative_path.replace(".parquet", ".jsonl"))
                if blob_json.exists():
                    return pd.read_json(io.BytesIO(blob_json.download_as_bytes()), lines=True)
                raise FileNotFoundError(f"Blob gs://{self.bucket_name}/{relative_path} not found")
            content = blob.download_as_bytes()
            if PYARROW_AVAILABLE:
                return pd.read_parquet(io.BytesIO(content), engine="pyarrow")
            else:
                raise RuntimeError("pyarrow is required to read Parquet format")
        else:
            dest = Path(self.local_mock_dir) / relative_path
            if not dest.exists():
                fallback_dest = Path(self.local_mock_dir) / relative_path.replace(".parquet", ".jsonl")
                if fallback_dest.exists():
                    return pd.read_json(fallback_dest, lines=True)
                raise FileNotFoundError(f"File {dest} not found")
            if PYARROW_AVAILABLE:
                return pd.read_parquet(dest, engine="pyarrow")
            else:
                # If pyarrow is missing, check if jsonl exists
                fallback_dest = Path(self.local_mock_dir) / relative_path.replace(".parquet", ".jsonl")
                if fallback_dest.exists():
                    return pd.read_json(fallback_dest, lines=True)
                raise RuntimeError("pyarrow is required to read Parquet format")

    def read_inference_partitions(
        self,
        start_time: datetime,
        end_time: datetime,
        prefix: str = "inference_logs",
        columns: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Scans and collects partitioned inference logs across the [start_time, end_time] window.
        Partition hierarchy: {prefix}/year=YYYY/month=MM/day=DD/hour=HH/*.parquet
        """
        dfs = []
        # Generate hourly partition prefixes across window
        curr = start_time.replace(minute=0, second=0, microsecond=0)
        end_hour = end_time.replace(minute=0, second=0, microsecond=0)

        hours_to_scan = []
        while curr <= end_hour:
            part_str = (
                f"{prefix}/year={curr.year}/month={curr.strftime('%m')}/"
                f"day={curr.strftime('%d')}/hour={curr.strftime('%H')}"
            )
            hours_to_scan.append(part_str)
            curr += timedelta(hours=1)

        logger.info("Scanning %d hourly partitions between %s and %s", len(hours_to_scan), start_time, end_time)

        for partition in hours_to_scan:
            files_in_partition = self._list_partition_files(partition)
            for fpath in files_in_partition:
                try:
                    df = self._read_partition_file(fpath, columns=columns)
                    if not df.empty:
                        # Filter by timestamp column if present
                        if "timestamp" in df.columns:
                            df["_parsed_ts"] = pd.to_datetime(df["timestamp"], utc=True)
                            mask = (df["_parsed_ts"] >= start_time) & (df["_parsed_ts"] <= end_time)
                            df = df[mask].drop(columns=["_parsed_ts"])
                        if not df.empty:
                            dfs.append(df)
                except Exception as e:
                    logger.warning("Error reading partition file %s: %s", fpath, e)

        if not dfs:
            logger.info("No inference logs found for window [%s, %s]", start_time, end_time)
            return pd.DataFrame(columns=columns)

        combined_df = pd.concat(dfs, ignore_index=True)
        logger.info("Successfully loaded %d inference records from window", len(combined_df))
        return combined_df

    def _list_partition_files(self, partition_prefix: str) -> List[str]:
        """Lists files matching partition prefix."""
        files = []
        if self.bucket:
            blobs = self.bucket.list_blobs(prefix=partition_prefix)
            for b in blobs:
                if b.name.endswith(".parquet") or b.name.endswith(".jsonl"):
                    files.append(b.name)
        else:
            base = Path(self.local_mock_dir) / partition_prefix
            if base.exists():
                for p in base.rglob("*"):
                    if p.is_file() and (p.suffix == ".parquet" or p.suffix == ".jsonl"):
                        files.append(str(p.relative_to(self.local_mock_dir)))
        return files

    def _read_partition_file(self, relative_path: str, columns: Optional[List[str]] = None) -> pd.DataFrame:
        if relative_path.endswith(".parquet") and PYARROW_AVAILABLE:
            if self.bucket:
                data = self.bucket.blob(relative_path).download_as_bytes()
                return pd.read_parquet(io.BytesIO(data), columns=columns, engine="pyarrow")
            else:
                full_path = Path(self.local_mock_dir) / relative_path
                return pd.read_parquet(full_path, columns=columns, engine="pyarrow")
        else:
            # Fallback for jsonl or when pyarrow not available
            if self.bucket:
                data = self.bucket.blob(relative_path).download_as_text()
                lines = [json.loads(line) for line in data.strip().split("\n") if line.strip()]
            else:
                full_path = Path(self.local_mock_dir) / relative_path
                with open(full_path, "r", encoding="utf-8") as f:
                    lines = [json.loads(line) for line in f if line.strip()]
            df = pd.DataFrame(lines)
            if columns:
                available_cols = [c for c in columns if c in df.columns]
                df = df[available_cols]
            return df
