# Build from project root:
#   docker build -t bacowr-worker -f worker/Dockerfile .
#
# Run:
#   docker run --env-file worker/.env -p 8080:8080 bacowr-worker

FROM python:3.12-slim

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies (needed for some Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (worker + pipeline)
COPY worker/requirements.txt ./worker-requirements.txt
COPY requirements.txt ./pipeline-requirements.txt
RUN pip install --no-cache-dir \
    -r worker-requirements.txt \
    -r pipeline-requirements.txt

# Copy the BACOWR pipeline modules into a package directory
COPY pipeline.py engine.py models.py article_validator.py ./bacowr/
COPY SYSTEM.md ./bacowr/

# Copy the worker code
COPY worker/ ./worker/

# The worker imports from the bacowr package via sys.path manipulation.
# We set the parent so that article_generator.py can find pipeline.py etc.
ENV PYTHONPATH="/app/bacowr:/app/worker"

WORKDIR /app/worker

EXPOSE 8080

# Health check for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
