FROM python:3.10

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for caching)
COPY environment_details/requirements.txt /app/requirements.txt

# Install Python deps (CPU-safe)
RUN pip install --upgrade pip && \
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r requirements.txt

# Copy project code
COPY . /app

ENV PYTHONUNBUFFERED=1
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV NUMEXPR_NUM_THREADS=1
ENV TORCH_NUM_THREADS=1
ENV TORCH_NUM_INTEROP_THREADS=1
ENV ANALYSIS_WORKERS=1
ENV MALLOC_ARENA_MAX=2
ENV PORT=8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
