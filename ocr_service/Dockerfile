# OCR service Dockerfile (Python)
FROM python:3.11-slim
WORKDIR /usr/src/app

# Install system dependencies required for pdf rendering and image processing
# poppler-utils provides pdftoppm; tesseract for optional Tesseract path; other libs are for OpenCV
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
	poppler-utils \
	tesseract-ocr \
	libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 libgomp1 \
	&& rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# If a pre-populated wheelhouse exists on the build context, copy it
# and install from it to avoid slow network downloads during the build.
COPY wheelhouse /wheelhouse
# Try to install from a local wheelhouse (if provided in the build context).
# If that fails (for example the wheelhouse contains macOS wheels and the
# build is running on a Linux base image), fall back to a normal network
# installation from PyPI so the build can continue.
RUN if [ -d /wheelhouse ] && [ "$(ls -A /wheelhouse)" ]; then \
			pip install --no-cache-dir --no-index --find-links /wheelhouse -r requirements.txt || \
			pip install --no-cache-dir -r requirements.txt; \
		else \
			pip install --no-cache-dir -r requirements.txt; \
		fi

# Copy service sources
COPY . .

# Ensure uvicorn binds to all interfaces inside the container
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
