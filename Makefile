.PHONY: help setup install seed serve worker-run simulate-drift retrain test lint docker-up docker-down clean web

PYTHON ?= .venv/bin/python
PIP ?= .venv/bin/pip

help:
	@echo "Data Drift Monitoring & Retraining Platform CLI Commands:"
	@echo "  make setup          - Set up directories and environment"
	@echo "  make install        - Install dependencies into local .venv"
	@echo "  make seed           - Generate baseline synthetic dataset and Champion v1 model"
	@echo "  make serve          - Start FastAPI model serving service"
	@echo "  make worker-run     - Execute near-real-time batch drift worker"
	@echo "  make ingest-file    - Ingest and harmonize external data (FILE=... CONFIG=...)"
	@echo "  make simulate-drift - Inject controlled data drift into inference logs"
	@echo "  make retrain        - Execute challenger training, offline evaluation, and promotion"
	@echo "  make test           - Run automated unit and statistical tests"
	@echo "  make test-adapter   - Run unit tests for data adapter layer"
	@echo "  make docker-up      - Start local Postgres and Serving via docker-compose"
	@echo "  make docker-down    - Tear down docker-compose services"
	@echo "  make clean          - Remove temporary artifacts and caches"

setup:
	mkdir -p data/gcs_mock data/models data/inference_logs data/reports tests/fixtures
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi

install:
	$(PIP) install -r serving/requirements.txt -r worker/requirements.txt pytest

seed: setup
	bash scripts/seed_baseline.sh

serve:
	$(PYTHON) -m uvicorn serving.main:app --host 0.0.0.0 --port 8000 --reload

worker-run:
	$(PYTHON) -m worker.run --window-hours 6

ingest-file:
	$(PYTHON) -m worker.adapter --source $(FILE) --config $(CONFIG) --score

simulate-drift:
	$(PYTHON) -m worker.simulate_drift --samples 500 --drift-types mean_shift,category_shift --severity high

retrain:
	$(PYTHON) -m retrain.train --data-source recent_logs
	$(PYTHON) -m retrain.evaluate
	$(PYTHON) -m retrain.promote

test:
	$(PYTHON) -m pytest -v tests/

test-adapter:
	$(PYTHON) -m pytest -v tests/test_adapter.py

lint:
	$(PYTHON) -m flake8 serving worker retrain tests || true

docker-up:
	docker compose up -d

web:
	cd web && npm run dev

docker-down:
	docker compose down -v

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache
