FROM python:3.12-slim
WORKDIR /app

# Install the local host package (build context is the bsquare/ monorepo root)
COPY packages/host /app/packages/host
RUN pip install --no-cache-dir /app/packages/host "pydantic-ai" "uvicorn[standard]" "starlette<1.0"

COPY examples/single-agent/backend /app/backend
WORKDIR /app/backend
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
