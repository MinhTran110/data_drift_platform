import time
from typing import List, Optional, Union
from pydantic import BaseModel, Field

# Try importing pyarrow for Parquet schema definitions
try:
    import pyarrow as pa
    PYARROW_AVAILABLE = True
except ImportError:
    pa = None
    PYARROW_AVAILABLE = False


class FeaturePayload(BaseModel):
    """Features required for credit default risk prediction."""
    age: float = Field(..., ge=18, le=120, description="Age in years")
    annual_income: float = Field(..., ge=0, description="Gross annual income in USD")
    credit_score: float = Field(..., ge=300, le=850, description="FICO score")
    debt_to_income_ratio: float = Field(..., ge=0.0, le=3.0, description="Debt to income ratio")
    loan_amount: float = Field(..., gt=0, description="Requested loan amount in USD")
    interest_rate: float = Field(..., ge=0.0, le=50.0, description="Interest rate percentage")
    home_ownership: str = Field(..., description="RENT, OWN, MORTGAGE, OTHER")
    loan_intent: str = Field(..., description="PERSONAL, EDUCATION, MEDICAL, VENTURE, HOMEIMPROVEMENT, DEBTCONSOLIDATION")
    employment_history_length: float = Field(..., ge=0.0, le=70.0, description="Years in workforce")


class SinglePredictionRequest(FeaturePayload):
    request_id: Optional[str] = None


class BatchPredictionRequest(BaseModel):
    records: List[FeaturePayload]
    request_id: Optional[str] = None


class PredictionResult(BaseModel):
    request_id: str
    prediction_score: float = Field(..., description="Default risk probability [0.0, 1.0]")
    prediction_label: int = Field(..., description="Binary decision (0 = approve, 1 = default risk)")
    model_version: str


class PredictionResponse(BaseModel):
    predictions: List[PredictionResult]
    model_version: str
    latency_ms: float
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    model_version: str
    model_loaded: bool
    buffer_count: int
    storage_mode: str
    uptime_seconds: float


# PyArrow Schema for writing high-performance Parquet logs to GCS/Storage
if PYARROW_AVAILABLE:
    INFERENCE_LOG_SCHEMA = pa.schema([
        pa.field("request_id", pa.string(), nullable=False),
        pa.field("timestamp", pa.string(), nullable=False),
        pa.field("model_version", pa.string(), nullable=False),
        pa.field("age", pa.float64(), nullable=True),
        pa.field("annual_income", pa.float64(), nullable=True),
        pa.field("credit_score", pa.float64(), nullable=True),
        pa.field("debt_to_income_ratio", pa.float64(), nullable=True),
        pa.field("loan_amount", pa.float64(), nullable=True),
        pa.field("interest_rate", pa.float64(), nullable=True),
        pa.field("home_ownership", pa.string(), nullable=True),
        pa.field("loan_intent", pa.string(), nullable=True),
        pa.field("employment_history_length", pa.float64(), nullable=True),
        pa.field("prediction_score", pa.float64(), nullable=False),
        pa.field("prediction_label", pa.int64(), nullable=False),
        pa.field("latency_ms", pa.float64(), nullable=False),
    ])
else:
    INFERENCE_LOG_SCHEMA = None
