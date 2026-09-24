import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Union

import pandas as pd
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from serving.log_writer import InferenceLogWriter
from serving.model_loader import ModelLoader
from serving.schemas import (
    BatchPredictionRequest,
    HealthResponse,
    PredictionResponse,
    PredictionResult,
    SinglePredictionRequest,
)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("serving.main:app", host="0.0.0.0", port=8000, reload=True)
