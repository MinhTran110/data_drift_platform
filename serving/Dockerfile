FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY serving/requirements.txt /app/serving/requirements.txt
RUN pip install --no-cache-dir -r /app/serving/requirements.txt

# Copy source code and config
COPY config/ /app/config/
COPY serving/ /app/serving/

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "serving.main:app", "--host", "0.0.0.0", "--port", "8000"]
