import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Union

import pandas as pd
import yaml
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from serving.log_writer import InferenceLogWriter
from serving.model_loader import ModelLoader
from serving.schemas import (
    BatchPredictionRequest,
    HealthResponse,
    IngestBatchRequest,
    IngestPathRequest,
    IngestResponse,
    PredictionResponse,
    PredictionResult,
    SinglePredictionRequest,
)
from worker.adapter import DataAdapter

# Logging configuration
logging.basicConfig(
    level=os.getenv("SERVING_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("serving.main")

START_TIME = time.time()
log_writer: InferenceLogWriter = None
model_loader: ModelLoader = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global log_writer, model_loader
    logger.info("Initializing Model Serving Service...")

    # Initialize model loader
    model_loader = ModelLoader()
    logger.info("Model loader ready. Current version: %s", model_loader.version)

    # Initialize buffered inference log writer
    log_writer = InferenceLogWriter()
    log_writer.start()
    logger.info("Inference log writer started in mode: %s", log_writer.stats["storage_mode"])

    yield

    logger.info("Shutting down Model Serving Service...")
    if log_writer:
        log_writer.stop()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="Data Drift Monitoring - Model Serving API",
    description="Near-real-time model serving with automated inference logging for drift detection",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health():
    uptime = time.time() - START_TIME
    return HealthResponse(
        status="healthy",
        model_version=model_loader.version if model_loader else "unloaded",
        model_loaded=model_loader.model is not None if model_loader else False,
        buffer_count=log_writer.get_buffer_count() if log_writer else 0,
        storage_mode=log_writer.stats["storage_mode"] if log_writer else "unknown",
        uptime_seconds=round(uptime, 2),
    )


@app.post("/predict", response_model=PredictionResponse)
def predict(request_data: Union[SinglePredictionRequest, BatchPredictionRequest]):
    start_t = time.time()

    # Normalize request to list of dicts
    if isinstance(request_data, SinglePredictionRequest):
        records = [request_data.model_dump(exclude={"request_id"})]
        req_id = request_data.request_id or f"req_{uuid.uuid4().hex[:10]}"
        req_ids = [req_id]
    else:
        records = [r.model_dump() for r in request_data.records]
        req_ids = [f"req_{uuid.uuid4().hex[:10]}" for _ in records]

    if not records:
        raise HTTPException(status_code=400, detail="Empty prediction request")

    df = pd.DataFrame(records)

    # Run inference
    scores, labels = model_loader.predict(df)
    latency_ms = (time.time() - start_t) * 1000.0

    timestamp_str = datetime.now(timezone.utc).isoformat()
    results: List[PredictionResult] = []
    log_entries: List[Dict] = []

    for i in range(len(records)):
        result = PredictionResult(
            request_id=req_ids[i],
            prediction_score=float(scores[i]),
            prediction_label=int(labels[i]),
            model_version=model_loader.version,
        )
        results.append(result)

        # Build inference log record
        log_record = {
            "request_id": req_ids[i],
            "timestamp": timestamp_str,
            "model_version": model_loader.version,
            "age": float(records[i].get("age", 0)),
            "annual_income": float(records[i].get("annual_income", 0)),
            "credit_score": float(records[i].get("credit_score", 0)),
            "debt_to_income_ratio": float(records[i].get("debt_to_income_ratio", 0)),
            "loan_amount": float(records[i].get("loan_amount", 0)),
            "interest_rate": float(records[i].get("interest_rate", 0)),
            "home_ownership": str(records[i].get("home_ownership", "")),
            "loan_intent": str(records[i].get("loan_intent", "")),
            "employment_history_length": float(records[i].get("employment_history_length", 0)),
            "prediction_score": float(scores[i]),
            "prediction_label": int(labels[i]),
            "latency_ms": round(latency_ms / len(records), 3),
        }
        log_entries.append(log_record)

    # Buffer inference logs non-blockingly
    if log_writer:
        log_writer.log_batch(log_entries)

    return PredictionResponse(
        predictions=results,
        model_version=model_loader.version,
        latency_ms=round(latency_ms, 2),
        timestamp=timestamp_str,
    )


@app.post("/admin/reload-model")
def reload_model():
    """Forces the model loader to reload from latest.json."""
    if not model_loader:
        raise HTTPException(status_code=500, detail="Model loader not initialized")
    reloaded = model_loader.reload_if_updated(force=True)
    return {
        "status": "success" if reloaded else "fallback_or_unchanged",
        "current_version": model_loader.version,
        "metadata": model_loader.metadata,
    }


@app.post("/admin/flush")
def flush_logs():
    """Forces immediate flush of buffered inference logs."""
    if not log_writer:
        raise HTTPException(status_code=500, detail="Log writer not initialized")
    count_before = log_writer.get_buffer_count()
    log_writer.flush()
    return {
        "status": "flushed",
        "drained_records": count_before,
        "stats": log_writer.stats,
    }


# =============================================================================
# DATA INGESTION & ADAPTER ENDPOINTS
# =============================================================================

def _resolve_adapter_config(adapter_name: str) -> str:
    """Resolves adapter name or path to a valid YAML/JSON config file."""
    if Path(adapter_name).exists():
        return adapter_name
    candidate = Path("config/adapters") / f"{adapter_name.replace('.yaml', '')}.yaml"
    if candidate.exists():
        return str(candidate)
    candidate_json = Path("config/adapters") / f"{adapter_name.replace('.json', '')}.json"
    if candidate_json.exists():
        return str(candidate_json)
    raise HTTPException(status_code=404, detail=f"Adapter config '{adapter_name}' not found in config/adapters/")


@app.get("/ingest/adapters", tags=["Data Ingestion & Adapters"])
def list_adapters():
    """Lists all available data adapter mapping templates."""
    adapter_dir = Path("config/adapters")
    results = []
    if adapter_dir.exists():
        for f in adapter_dir.glob("*.yaml"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = yaml.safe_load(fp)
                    results.append({
                        "name": f.stem,
                        "file": str(f),
                        "source_name": data.get("source_name", f.stem),
                        "description": data.get("description", ""),
                        "mapped_columns": list(data.get("column_mapping", {}).keys()),
                        "derivations": list(data.get("derivations", {}).keys()),
                    })
            except Exception as e:
                logger.warning("Error reading adapter %s: %s", f, e)
    return {"adapters": results}


@app.post("/ingest/path", response_model=IngestResponse, tags=["Data Ingestion & Adapters"])
def ingest_from_path(request_data: IngestPathRequest):
    """
    Ingests and harmonizes data from a local file path, glob pattern, or DB connection.
    Automatically standardizes schema, runs model scoring, and flushes to Hive partitions.
    """
    cfg_path = _resolve_adapter_config(request_data.adapter_name)
    adapter = DataAdapter()

    try:
        result = adapter.run_ingest(
            source=request_data.source,
            config_path=cfg_path,
            score=request_data.auto_score,
            watermark_file=request_data.watermark_file,
        )
    except Exception as e:
        logger.error("Ingestion error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    if result.get("status") == "NO_NEW_DATA":
        return IngestResponse(
            status="NO_NEW_DATA",
            record_count=0,
            sources=result.get("sources", [request_data.source]),
            saved_partition="",
            sample_records=[],
        )

    return IngestResponse(
        status="SUCCESS",
        record_count=result["record_count"],
        sources=result["sources"],
        saved_partition=result["saved_partition"],
    )


@app.post("/ingest/batch", response_model=IngestResponse, tags=["Data Ingestion & Adapters"])
def ingest_raw_batch(request_data: IngestBatchRequest):
    """
    Ingests an in-memory JSON array of raw records in external format.
    Transforms them via the selected adapter, scores them, and persists to storage.
    """
    if not request_data.records:
        raise HTTPException(status_code=400, detail="Empty records list")

    cfg_path = _resolve_adapter_config(request_data.adapter_name)
    adapter = DataAdapter()
    raw_df = pd.DataFrame(request_data.records)

    try:
        clean_df = adapter.transform(raw_df, cfg_path)
        if request_data.auto_score:
            clean_df = adapter.score_with_model(clean_df)
        saved_path = adapter.save_to_partitions(clean_df)
    except Exception as e:
        logger.error("Batch ingest error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    samples = clean_df.head(3).to_dict(orient="records")
    return IngestResponse(
        status="SUCCESS",
        record_count=len(clean_df),
        sources=["in_memory_json_batch"],
        saved_partition=saved_path,
        sample_records=samples,
    )


@app.post("/ingest/file", response_model=IngestResponse, tags=["Data Ingestion & Adapters"])
async def ingest_uploaded_file(
    request: Request,
    filename: str = "uploaded_data.csv",
    adapter_name: str = "crm_sample",
    auto_score: bool = True,
):
    """
    Uploads a raw data file (CSV, Excel, Parquet, JSONL) via binary body payload.
    Example: curl -X POST 'http://localhost:8000/ingest/file?filename=data.csv&adapter_name=crm_sample' --data-binary @data.csv
    """
    data_bytes = await request.body()
    if not data_bytes:
        raise HTTPException(status_code=400, detail="Empty file payload")

    cfg_path = _resolve_adapter_config(adapter_name)
    adapter = DataAdapter()

    try:
        raw_df = adapter.extract_from_bytes(data_bytes, filename=filename)
        clean_df = adapter.transform(raw_df, cfg_path)
        if auto_score:
            clean_df = adapter.score_with_model(clean_df)
        saved_path = adapter.save_to_partitions(clean_df)
    except Exception as e:
        logger.error("File upload ingest error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    samples = clean_df.head(3).to_dict(orient="records")
    return IngestResponse(
        status="SUCCESS",
        record_count=len(clean_df),
        sources=[filename],
        saved_partition=saved_path,
        sample_records=samples,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("serving.main:app", host="0.0.0.0", port=8000, reload=True)
