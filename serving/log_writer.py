import asyncio
import io
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    from serving.schemas import INFERENCE_LOG_SCHEMA
    PYARROW_AVAILABLE = True
except ImportError:
    PYARROW_AVAILABLE = False
    INFERENCE_LOG_SCHEMA = None

try:
    from google.cloud import storage
    GCS_CLIENT_AVAILABLE = True
except ImportError:
    GCS_CLIENT_AVAILABLE = False

logger = logging.getLogger("serving.log_writer")


class InferenceLogWriter:
    """
    High-throughput non-blocking inference logger.
    Buffers predictions in memory and flushes them to Parquet partitions
    on GCS or local mock storage on interval or batch capacity.
    """

    def __init__(
        self,
        bucket_name: Optional[str] = None,
        prefix: str = "inference_logs",
        local_mock_dir: Optional[str] = None,
        buffer_size: int = 200,
        flush_interval_seconds: float = 15.0,
    ):
        self.bucket_name = bucket_name or os.getenv("GCS_BUCKET_NAME", "drift-platform-data")
        self.prefix = prefix or os.getenv("GCS_LOG_PREFIX", "inference_logs")
        self.local_mock_dir = local_mock_dir or os.getenv("GCS_LOCAL_MOCK_DIR", "./data/gcs_mock")
        self.buffer_size = int(os.getenv("SERVING_BUFFER_SIZE", buffer_size))
        self.flush_interval_seconds = float(os.getenv("SERVING_FLUSH_INTERVAL_SECONDS", flush_interval_seconds))

        self._buffer: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._last_flush_time = time.time()
        self._stop_event = threading.Event()
        self._flush_task: Optional[threading.Thread] = None

        self.stats = {
            "total_logged": 0,
            "total_flushed": 0,
            "flush_count": 0,
            "last_flush_time": None,
            "storage_mode": "mock",
        }

        # Initialize GCS client if enabled and credentials available
        self.gcs_client = None
        self.bucket = None
        self._init_storage()

    def _init_storage(self):
        use_mock = os.getenv("APP_ENV") == "development" or self.local_mock_dir is not None
        if not use_mock and GCS_CLIENT_AVAILABLE and os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            try:
                self.gcs_client = storage.Client()
                self.bucket = self.gcs_client.bucket(self.bucket_name)
                self.stats["storage_mode"] = f"gcs://{self.bucket_name}"
                logger.info("Initialized GCS log writer to gs://%s/%s", self.bucket_name, self.prefix)
                return
            except Exception as e:
                logger.warning("Failed to initialize GCS client (%s). Falling back to local storage.", e)

        # Fallback to local directory
        self.stats["storage_mode"] = f"local:{self.local_mock_dir}"
        Path(self.local_mock_dir).mkdir(parents=True, exist_ok=True)
        logger.info("Using local mock storage at %s", self.local_mock_dir)

    def start(self):
        """Starts the background worker thread for periodic flushing."""
        if self._flush_task is None or not self._flush_task.is_alive():
            self._stop_event.clear()
            self._flush_task = threading.Thread(target=self._background_flush_loop, daemon=True)
            self._flush_task.start()
            logger.info("Started background log writer flush thread")

    def stop(self):
        """Stops the background worker thread and performs a final flush."""
        logger.info("Stopping log writer...")
        self._stop_event.set()
        if self._flush_task and self._flush_task.is_alive():
            self._flush_task.join(timeout=5.0)
        self.flush()
        logger.info("Log writer stopped. Final stats: %s", self.stats)

    def log(self, record: Dict[str, Any]):
        """Append an inference record to buffer. Triggers flush if buffer size reached."""
        should_flush = False
        with self._lock:
            self._buffer.append(record)
            self.stats["total_logged"] += 1
            if len(self._buffer) >= self.buffer_size:
                should_flush = True

        if should_flush:
            self.flush()

    def log_batch(self, records: List[Dict[str, Any]]):
        """Append multiple records at once."""
        should_flush = False
        with self._lock:
            self._buffer.extend(records)
            self.stats["total_logged"] += len(records)
            if len(self._buffer) >= self.buffer_size:
                should_flush = True

        if should_flush:
            self.flush()

    def get_buffer_count(self) -> int:
        with self._lock:
            return len(self._buffer)

    def _background_flush_loop(self):
        while not self._stop_event.is_set():
            time.sleep(1.0)
            now = time.time()
            if now - self._last_flush_time >= self.flush_interval_seconds:
                if self.get_buffer_count() > 0:
                    self.flush()

    def flush(self):
        """Drains the in-memory buffer and writes a partitioned Parquet batch."""
        with self._lock:
            if not self._buffer:
                return
            records_to_flush = self._buffer
            self._buffer = []
            self._last_flush_time = time.time()

        now = datetime.now(timezone.utc)
        partition_path = (
            f"{self.prefix}/year={now.year}/month={now.strftime('%m')}/"
            f"day={now.strftime('%d')}/hour={now.strftime('%H')}"
        )
        file_uuid = uuid.uuid4().hex[:12]

        try:
            if PYARROW_AVAILABLE:
                file_name = f"inference_{now.strftime('%Y%m%d_%H%M%S')}_{file_uuid}.parquet"
                full_path = f"{partition_path}/{file_name}"
                parquet_bytes = self._records_to_parquet_bytes(records_to_flush)
                self._write_bytes(full_path, parquet_bytes)
            else:
                # Fallback to json lines if pyarrow is unavailable in test environment
                file_name = f"inference_{now.strftime('%Y%m%d_%H%M%S')}_{file_uuid}.jsonl"
                full_path = f"{partition_path}/{file_name}"
                content = "\n".join(json.dumps(r) for r in records_to_flush).encode("utf-8")
                self._write_bytes(full_path, content)

            self.stats["total_flushed"] += len(records_to_flush)
            self.stats["flush_count"] += 1
            self.stats["last_flush_time"] = now.isoformat()
            logger.info("Successfully flushed %d records to %s", len(records_to_flush), full_path)
        except Exception as e:
            logger.error("Failed to flush inference logs: %s", e, exc_info=True)
            # Re-buffer records to prevent data loss
            with self._lock:
                self._buffer = records_to_flush + self._buffer

    def _records_to_parquet_bytes(self, records: List[Dict[str, Any]]) -> bytes:
        """Converts records list to PyArrow Table and serializes to Parquet bytes."""
        columns: Dict[str, List[Any]] = {}
        # Ensure all columns in schema are present
        if INFERENCE_LOG_SCHEMA:
            field_names = [f.name for f in INFERENCE_LOG_SCHEMA]
        else:
            field_names = list(records[0].keys())

        for name in field_names:
            columns[name] = [r.get(name) for r in records]

        if INFERENCE_LOG_SCHEMA:
            table = pa.Table.from_pydict(columns, schema=INFERENCE_LOG_SCHEMA)
        else:
            table = pa.Table.from_pydict(columns)

        sink = io.BytesIO()
        pq.write_table(table, sink, compression="snappy")
        return sink.getvalue()

    def _write_bytes(self, relative_path: str, data: bytes):
        """Writes byte stream to either GCS or local directory."""
        if self.bucket is not None:
            blob = self.bucket.blob(relative_path)
            blob.upload_from_string(data, content_type="application/octet-stream")
        else:
            dest = Path(self.local_mock_dir) / relative_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
