FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY batch_analysis_trial/requirements.txt /app/batch_analysis_trial/requirements.txt
RUN pip install --no-cache-dir -r /app/batch_analysis_trial/requirements.txt
COPY event_detection/__init__.py event_detection/dynamic_baseline_detector.py event_detection/dynamic_baseline_web.py event_detection/dynamic_baseline_comparison.py /app/event_detection/
COPY batch_analysis_trial/run_batch.py /app/batch_analysis_trial/run_batch.py
ENTRYPOINT ["python", "batch_analysis_trial/run_batch.py"]
CMD ["--input", "/input", "--output", "/output"]
